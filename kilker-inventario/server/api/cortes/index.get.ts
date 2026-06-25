// ───────────────────────────────────────────────
//  GET /api/cortes — historial de cortes de caja
// ───────────────────────────────────────────────
// Empleado: su tienda. Admin: todos (filtro ?storeId).
import { and, desc, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { cashCloseouts } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  const filters = []
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(eq(cashCloseouts.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(cashCloseouts.storeId, storeId))
  }

  const rows = await db.query.cashCloseouts.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(cashCloseouts.createdAt)],
    limit: 200,
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } }
    }
  })

  return rows.map((c) => ({
    id: c.id,
    storeId: c.storeId,
    storeCode: c.store?.code ?? null,
    storeName: c.store?.name ?? null,
    createdByName: c.createdBy?.fullName ?? null,
    periodFrom: c.periodFrom,
    periodTo: c.periodTo,
    salesCount: c.salesCount,
    totalEmitido: c.totalEmitido,
    totalEfectivo: c.totalEfectivo,
    totalTarjeta: c.totalTarjeta,
    totalTransferencia: c.totalTransferencia,
    voidedCount: c.voidedCount,
    totalVoided: c.totalVoided,
    note: c.note,
    createdAt: c.createdAt
  }))
})
