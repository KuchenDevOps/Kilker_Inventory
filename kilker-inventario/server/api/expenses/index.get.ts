// ───────────────────────────────────────────────
//  GET /api/expenses — historial de gastos con líneas y estado de pago
// ───────────────────────────────────────────────
import { and, count, desc, eq, gte, ilike, inArray, lt, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { expenses, expenseItems } from '../../db/schema'

const IVA_RATE = 0.16

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

  const typeParam = String(query.type ?? '').trim()
  if (typeParam === 'Fijo' || typeParam === 'Operativo') {
    filters.push(eq(expenses.type, typeParam))
  }

  const fromDate = toDateOnly(query.from)
  const toDate = toDateOnly(query.to)
  if (fromDate) filters.push(gte(expenses.paidAt, fromDate))
  if (toDate) filters.push(lt(expenses.paidAt, toDate))

  // ─── Búsqueda: proveedor, número de factura, o concepto de alguna línea ───
  const q = String(query.q ?? '').trim()
  if (q) {
    const like = `%${q}%`

    // Resolvemos el match de "reason" en items como una consulta aparte,
    // en vez de un EXISTS correlacionado crudo (incompatible con el modo
    // relacional de db.query, que re-aliasea las tablas y rompe la referencia).
    const matchingItemRows = await db
      .select({ expenseId: expenseItems.expenseId })
      .from(expenseItems)
      .where(ilike(expenseItems.reason, like))

    const matchingExpenseIds = [...new Set(matchingItemRows.map((r) => r.expenseId))]

    const searchConditions = [ilike(expenses.supplier, like), ilike(expenses.supplierInvoiceNumber, like)]
    if (matchingExpenseIds.length) {
      searchConditions.push(inArray(expenses.id, matchingExpenseIds))
    }
    filters.push(or(...searchConditions)!)
  }
  // ─── fin del bloque de búsqueda ───

  const whereClause = filters.length ? and(...filters) : undefined
  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.expenses.findMany({
    where: whereClause,
    orderBy: [desc(expenses.paidAt)],
    ...(paginate ? { limit: pageSize, offset: (page - 1) * pageSize } : {}),
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } },
      payments: { columns: { amount: true } },
      items: { columns: { id: true, reason: true, amount: true } }
    }
  })

  const mapped = rows.map((e) => {
    const totalToPay = Math.round(Number(e.amount) * 100) / 100
    const totalPaid = Math.round(e.payments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100
    const balance = Math.max(0, Math.round((totalToPay - totalPaid) * 100) / 100)

    let paymentStatus: 'pendiente' | 'parcial' | 'pagado' = 'pendiente'
    if (totalPaid >= totalToPay && totalToPay > 0) paymentStatus = 'pagado'
    else if (totalPaid > 0) paymentStatus = 'parcial'

    const subtotal = Math.round(e.items.reduce((sum, it) => sum + Number(it.amount), 0) * 100) / 100
    const iva = Math.round(subtotal * IVA_RATE * 100) / 100

    return {
      id: e.id,
      storeId: e.storeId,
      storeCode: e.store?.code ?? null,
      storeName: e.store?.name ?? null,
      supplier: e.supplier,
      supplierInvoiceNumber: e.supplierInvoiceNumber,
      type: e.type,
      items: e.items,
      itemCount: e.items.length,
      subtotal,
      iva,
      retentionIva: e.retentionIva,
      retentionIsr: e.retentionIsr,
      amount: e.amount,
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

  if (!paginate) return mapped

  const [{ value: totalCount }] = await db.select({ value: count() }).from(expenses).where(whereClause)

  return { data: mapped, total: totalCount, page, pageSize }
})