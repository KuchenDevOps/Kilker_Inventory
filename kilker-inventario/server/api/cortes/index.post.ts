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
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { cashCloseouts, invoices, stores } from '../../db/schema'
import { fmtCorteDate, latestCloseoutOrder } from '../../utils/cortes'

interface CorteBody {
  storeId?: number
  note?: string
  /** Fecha/hora de cierre del corte (ISO). Solo admin; por omisión, ahora. */
  periodTo?: string
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

  // ───────────────────────────────────────────────
  //  Fecha de CIERRE del corte
  // ───────────────────────────────────────────────
  // ⚠️ Solo se elige el cierre; el INICIO se sigue encadenando solo al
  // `period_to` del corte anterior. Dejar elegir los dos abriría el hueco que
  // el encadenamiento evita por construcción: dos cortes traslapados cuentan
  // las mismas ventas dos veces, y dos cortes con espacio entre ellos dejan un
  // periodo que ningún corte cubre — y nadie se entera, porque cada corte por
  // separado cuadra.
  //
  // La fecha la elige cualquiera que pueda cortar (admin, empleado y
  // admin_tienda): el reparto de permisos del corte no cambia por esto — quien
  // podía hacer el corte de su tienda lo sigue haciendo, ahora pudiendo fecharlo.
  // El aislamiento por sucursal lo sigue poniendo `storeId` arriba.
  let requestedPeriodTo: Date | null = null
  if (body?.periodTo != null && String(body.periodTo).trim() !== '') {
    const parsed = new Date(String(body.periodTo))
    if (isNaN(parsed.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'Fecha de corte inválida' })
    }
    // Un cierre futuro deja "cortado" un periodo que todavía no ocurre: las
    // ventas que caigan ahí no entrarían en este corte (aún no existen) ni en
    // ninguno posterior (el siguiente arranca justo en este `period_to`).
    if (parsed.getTime() > Date.now()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'La fecha del corte no puede ser futura'
      })
    }
    requestedPeriodTo = parsed
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

    // Inicio = fin del último corte (null = desde el inicio). El orden sale del
    // helper compartido: "el último corte" tiene que significar lo mismo aquí,
    // en el DELETE y en el `isLatest` del listado.
    const last = await tx.query.cashCloseouts.findFirst({
      where: eq(cashCloseouts.storeId, storeId),
      orderBy: latestCloseoutOrder
    })
    const periodFrom = last?.periodTo ?? null
    const periodTo = requestedPeriodTo ?? new Date()

    // La cadena tiene que avanzar. Con un cierre anterior o igual al del corte
    // previo el periodo saldría vacío o invertido, y el siguiente corte
    // retrocedería su inicio (`period_from` = máximo `period_to`), recontando
    // ventas ya cortadas. La comparación va DENTRO del candado: `last` se lee
    // aquí, así que validarla fuera dejaría pasar dos cortes simultáneos.
    if (periodFrom && periodTo.getTime() <= periodFrom.getTime()) {
      throw createError({
        statusCode: 400,
        statusMessage: `La fecha del corte debe ser posterior al cierre del corte anterior (${fmtCorteDate(periodFrom)})`
      })
    }

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
