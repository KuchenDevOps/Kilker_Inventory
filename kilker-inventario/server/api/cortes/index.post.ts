// ───────────────────────────────────────────────
//  POST /api/cortes — hacer un corte de caja
// ───────────────────────────────────────────────
// Ventana desde el corte anterior; suma ventas emitidas (una columna por método
// de pago del enum) y anuladas.
//
// ⚠️ PENDIENTE (decisión de negocio abierta): la ventana se calcula sobre
// `issued_at`, y las ventas admiten fecha retroactiva. Una venta capturada hoy
// con fecha anterior al último corte cae fuera de toda ventana y no aparece en
// ningún corte. Las dos salidas posibles —cortar por `created_at`, o prohibir
// capturar ventas con fecha anterior al último corte de la tienda— están
// registradas en docs/CONTEXTO.md → "Preguntas abiertas".
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { cashCloseouts, invoices, stores } from '../../db/schema'

interface CorteBody {
  storeId?: number
  note?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const body = await readBody<CorteBody>(event)

  // Empleado corta su tienda; admin elige cualquiera.
  let storeId: number
  if (isStoreScopedRole(profile.role)) {
    if (profile.storeId == null) {
      throw createError({ statusCode: 403, statusMessage: 'Tu perfil no tiene tienda asignada' })
    }
    storeId = profile.storeId
  } else {
    storeId = Number(body?.storeId)
    if (!storeId) {
      throw createError({ statusCode: 400, statusMessage: 'storeId es requerido' })
    }
  }

  const db = useDb()

  // Todo el corte va en una transacción con la tienda bloqueada: leer el
  // último corte, calcular la ventana e insertar el nuevo tiene que ser
  // atómico. Sin el candado, dos cortes simultáneos de la misma tienda leen
  // el mismo `last`, calculan la misma ventana y se insertan los dos → las
  // ventas se cuentan por duplicado. Es el mismo candado (`stores` FOR
  // UPDATE) que ya serializa los folios de venta.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${stores} WHERE id = ${storeId} FOR UPDATE`)

    const store = await tx.query.stores.findFirst({ where: eq(stores.id, storeId) })
    if (!store) throw createError({ statusCode: 404, statusMessage: 'Tienda no existe' })

    // Inicio = fin del último corte (null = desde el inicio).
    const last = await tx.query.cashCloseouts.findFirst({
      where: eq(cashCloseouts.storeId, storeId),
      orderBy: [desc(cashCloseouts.periodTo)]
    })
    const periodFrom = last?.periodTo ?? null
    const periodTo = new Date()

    // Ventas dentro de la ventana [periodFrom, periodTo).
    const conds = [eq(invoices.storeId, storeId), lt(invoices.issuedAt, periodTo)]
    if (periodFrom) conds.push(gte(invoices.issuedAt, periodFrom))
    const rows = await tx
      // ⚠️ El corte va SIN IVA: cuenta `total_amount` (el subtotal, ya con el
      // descuento), no `total_to_pay`. Es una decisión del negocio, no un
      // descuido: el corte se usa como reporte de VENTA NETA, no como arqueo del
      // cajón. Consecuencia que hay que conocer antes de "corregirlo": el corte
      // reporta ~16% menos que el efectivo y las terminales que hay físicamente,
      // porque al cliente sí se le cobra el IVA (`total_to_pay`).
      .select({
        status: invoices.status,
        paymentMethod: invoices.paymentMethod,
        totalAmount: invoices.totalAmount
      })
      .from(invoices)
      .where(and(...conds))

    let salesCount = 0
    let totalEmitido = 0
    let totalEfectivo = 0
    let totalDebito = 0
    let totalCredito = 0
    let totalTransferencia = 0
    let voidedCount = 0
    let totalVoided = 0
    for (const r of rows) {
      const amount = Number(r.totalAmount)
      if (r.status === 'anulada') {
        voidedCount += 1
        totalVoided += amount
      } else {
        salesCount += 1
        totalEmitido += amount
        // ⚠️ Sin `default` que avise, un método nuevo del enum sumaría en
        // totalEmitido pero no en ninguna columna: el corte cuadraría de menos
        // y nadie se enteraría. Por eso el caso no contemplado revienta.
        switch (r.paymentMethod) {
          case 'efectivo':
            totalEfectivo += amount
            break

          case 'debito':
            totalDebito += amount
            break

          case 'credito':
            totalCredito += amount
            break

          case 'transferencia':
            totalTransferencia += amount
            break

          default:
            throw createError({
              statusCode: 500,
              statusMessage: `Método de pago sin columna en el corte: ${r.paymentMethod}`
            })
        }
      }
    }

    const [created] = await tx
      .insert(cashCloseouts)
      .values({
        storeId,
        createdBy: profile.id,
        periodFrom,
        periodTo,
        salesCount,
        totalEmitido: String(totalEmitido),
        totalEfectivo: String(totalEfectivo),
        totalDebito: String(totalDebito),
        totalCredito: String(totalCredito),
        totalTransferencia: String(totalTransferencia),
        voidedCount,
        totalVoided: String(totalVoided),
        note: typeof body?.note === 'string' ? body.note.trim() || null : null
      })
      .returning()

    return created
  })
})
