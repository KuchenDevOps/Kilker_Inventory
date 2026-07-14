// ───────────────────────────────────────────────
//  GET /api/expenses — historial de gastos
// ───────────────────────────────────────────────
// Empleado: su tienda. Admin: todas (filtro ?storeId).
// Filtros de fecha: ?from ?to (rango sobre paid_at).
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { useDb } from '../../db'
import { expenses } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)
  const db = useDb()

  const filters = []
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(eq(expenses.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(expenses.storeId, storeId))
  }

  if (query.from) filters.push(gte(expenses.paidAt, String(query.from)))
  if (query.to) filters.push(lt(expenses.paidAt, String(query.to)))

  const rows = await db.query.expenses.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(expenses.paidAt)],
    limit: 200,
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } }
    }
  })

  return rows.map((e) => ({
    id: e.id,
    storeId: e.storeId,
    storeCode: e.store?.code ?? null,
    storeName: e.store?.name ?? null,
    supplier: e.supplier,
    supplierInvoiceNumber: e.supplierInvoiceNumber,
    reason: e.reason,
    retentionIva: e.retentionIva,
    retentionIsr: e.retentionIsr,
    amount: e.amount,
    paidAt: e.paidAt,
    note: e.note,
    createdByName: e.createdBy?.fullName ?? null,
    createdAt: e.createdAt
  }))
})