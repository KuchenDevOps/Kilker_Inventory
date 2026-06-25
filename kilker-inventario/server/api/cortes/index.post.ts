// ───────────────────────────────────────────────
//  POST /api/cortes — hacer un corte de caja
// ───────────────────────────────────────────────
// Ventana desde el corte anterior; suma ventas emitidas (efectivo/tarjeta) y anuladas.
import { and, desc, eq, gte, lt } from 'drizzle-orm'
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
  if (profile.role === 'empleado') {
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

  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
  if (!store) throw createError({ statusCode: 404, statusMessage: 'Tienda no existe' })

  // Inicio = fin del último corte (null = desde el inicio).
  const last = await db.query.cashCloseouts.findFirst({
    where: eq(cashCloseouts.storeId, storeId),
    orderBy: [desc(cashCloseouts.periodTo)]
  })
  const periodFrom = last?.periodTo ?? null
  const periodTo = new Date()

  // Ventas dentro de la ventana [periodFrom, periodTo).
  const conds = [eq(invoices.storeId, storeId), lt(invoices.issuedAt, periodTo)]
  if (periodFrom) conds.push(gte(invoices.issuedAt, periodFrom))
  const rows = await db
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
  let totalTarjeta = 0
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
      switch(r.paymentMethod)
      {
        case 'efectivo':
          totalEfectivo += amount
          break

        case 'tarjeta':
          totalTarjeta += amount
          break

        case 'transferencia':
          totalTransferencia += amount
          break
      }
    }
  }

  const [created] = await db
    .insert(cashCloseouts)
    .values({
      storeId,
      createdBy: profile.id,
      periodFrom,
      periodTo,
      salesCount,
      totalEmitido: String(totalEmitido),
      totalEfectivo: String(totalEfectivo),
      totalTarjeta: String(totalTarjeta),
      totalTransferencia: String(totalTransferencia),
      voidedCount,
      totalVoided: String(totalVoided),
      note: typeof body?.note === 'string' ? body.note.trim() || null : null
    })
    .returning()

  return created
})
