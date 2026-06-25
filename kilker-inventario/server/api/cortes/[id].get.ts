// ───────────────────────────────────────────────
//  GET /api/cortes/:id — detalle de un corte
// ───────────────────────────────────────────────
// Snapshot + ventas del periodo. Empleado: su tienda. Admin: cualquiera.
import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { useDb } from '../../db'
import { cashCloseouts, invoices } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const db = useDb()
  const corte = await db.query.cashCloseouts.findFirst({
    where: eq(cashCloseouts.id, id),
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } }
    }
  })
  if (!corte) throw createError({ statusCode: 404, statusMessage: 'Corte no existe' })

  if (profile.role === 'empleado' && profile.storeId !== corte.storeId) {
    throw createError({ statusCode: 403, statusMessage: 'Corte de otra tienda' })
  }

  // Ventas en la ventana del corte [periodFrom, periodTo).
  const conds = [
    eq(invoices.storeId, corte.storeId),
    lt(invoices.issuedAt, corte.periodTo)
  ]
  if (corte.periodFrom) conds.push(gte(invoices.issuedAt, corte.periodFrom))
  const sales = await db.query.invoices.findMany({
    where: and(...conds),
    orderBy: [asc(invoices.issuedAt)],
    with: { createdBy: { columns: { fullName: true } } }
  })

  return {
    id: corte.id,
    storeId: corte.storeId,
    storeCode: corte.store?.code ?? null,
    storeName: corte.store?.name ?? null,
    createdByName: corte.createdBy?.fullName ?? null,
    periodFrom: corte.periodFrom,
    periodTo: corte.periodTo,
    salesCount: corte.salesCount,
    totalEmitido: corte.totalEmitido,
    totalEfectivo: corte.totalEfectivo,
    totalTarjeta: corte.totalTarjeta,
    totalTransferencia: corte.totalTransferencia,
    voidedCount: corte.voidedCount,
    totalVoided: corte.totalVoided,
    note: corte.note,
    createdAt: corte.createdAt,
    sales: sales.map((s) => ({
      id: s.id,
      folio: s.folio,
      status: s.status,
      paymentMethod: s.paymentMethod,
      totalAmount: s.totalAmount,
      createdByName: s.createdBy?.fullName ?? null,
      issuedAt: s.issuedAt
    }))
  }
})
