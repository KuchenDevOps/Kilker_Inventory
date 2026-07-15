// ───────────────────────────────────────────────
//  GET /api/expenses — historial de gastos con estado de pago
// ───────────────────────────────────────────────
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { useDb } from '../../db'
import { expenses } from '../../db/schema'

function toDateOnly(v: unknown): string | null {
  const s = String(v ?? '')
  const match = s.match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

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

  const fromDate = toDateOnly(query.from)
  const toDate = toDateOnly(query.to)
  if (fromDate) filters.push(gte(expenses.paidAt, fromDate))
  if (toDate) filters.push(lt(expenses.paidAt, toDate))

  const rows = await db.query.expenses.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(expenses.paidAt)],
    limit: 200,
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } },
      payments: { columns: { amount: true } }
    }
  })

return rows.map((e) => {
  const totalToPay = Math.round(Number(e.amount) * 100) / 100
  const totalPaid = Math.round(e.payments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100
  const balance = Math.max(0, Math.round((totalToPay - totalPaid) * 100) / 100)

  let paymentStatus: 'pendiente' | 'parcial' | 'pagado' = 'pendiente'
  if (totalPaid >= totalToPay && totalToPay > 0) paymentStatus = 'pagado'
  else if (totalPaid > 0) paymentStatus = 'parcial'

  return {
    id: e.id,
    storeId: e.storeId,
    storeCode: e.store?.code ?? null,
    storeName: e.store?.name ?? null,
    supplier: e.supplier,
    supplierInvoiceNumber: e.supplierInvoiceNumber,
    reason: e.reason,
    amount: e.amount,
    retentionIva: e.retentionIva,
    retentionIsr: e.retentionIsr,
    totalToPay,
    totalPaid,
    balance,
    paymentStatus,
    paidAt: e.paidAt,
    note: e.note,
    createdByName: e.createdBy?.fullName ?? null,
    createdAt: e.createdAt
  }
})
})