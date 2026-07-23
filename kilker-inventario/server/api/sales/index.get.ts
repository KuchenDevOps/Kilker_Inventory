// ───────────────────────────────────────────────
//  GET /api/sales — historial de ventas
// ───────────────────────────────────────────────
// Empleado: su tienda. Admin: todas (filtros ?storeId/?status/?productId).
import { and, count, desc, eq, gte, ilike, inArray, lt, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { customers, invoiceItems, invoices, profiles, stores, tickets } from '../../db/schema'


export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  const filters = []
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(eq(invoices.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(invoices.storeId, storeId))
  }
  if (query.status === 'emitida' || query.status === 'anulada') {
    filters.push(eq(invoices.status, query.status))
  }

  // Filtro por producto: ventas que contienen ese productId en alguna línea.
  if (query.productId) {
    const productId = Number(query.productId)
    if (productId) {
      const matchingInvoiceIds = await db
        .select({ invoiceId: invoiceItems.invoiceId })
        .from(invoiceItems)
        .where(eq(invoiceItems.productId, productId))
      const ids = matchingInvoiceIds.map((r) => r.invoiceId)
      // Si no hay ninguna venta con ese producto, corta temprano (evita un inArray vacío).
      if (ids.length === 0) return []
      filters.push(inArray(invoices.id, ids))
    }
  }

  if (query.from) filters.push(gte(invoices.issuedAt, new Date(String(query.from))))
  if (query.to) filters.push(lt(invoices.issuedAt, new Date(String(query.to))))

  const q = String(query.q ?? '').trim()
  if (q) {
    const like = `%${q}%`
    const [storeIds, profIds, customerIds] = await Promise.all([
      db.select({ id: stores.id }).from(stores).where(or(ilike(stores.name, like), ilike(stores.code, like))),
      db.select({ id: profiles.id }).from(profiles).where(ilike(profiles.fullName, like)),
      db.select({ id: customers.id }).from(customers).where(ilike(customers.name, like))
    ])

    const orParts = [ilike(invoices.folio, like)]
    const pm = q.toLowerCase()
    for (const m of ['efectivo', 'tarjeta', 'transferencia'] as const) {
      if (m.includes(pm)) orParts.push(eq(invoices.paymentMethod, m))
    }
    if (storeIds.length) orParts.push(inArray(invoices.storeId, storeIds.map((r) => r.id)))
    if (profIds.length) orParts.push(inArray(invoices.createdBy, profIds.map((r) => r.id)))
    if (customerIds.length) orParts.push(inArray(invoices.customerId, customerIds.map((r) => r.id)))
    filters.push(or(...orParts)!)
  }

  const whereClause = filters.length ? and(...filters) : undefined
const paginate = query.page != null
const page = Math.max(1, Number(query.page) || 1)
const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

const limit = paginate ? pageSize : 200
const offset = paginate ? (page - 1) * pageSize : 0

const rows = await db.query.invoices.findMany({
  where: whereClause,
  orderBy: [desc(invoices.issuedAt)],
  limit,
  offset,
  with: {
    store: { columns: { code: true, name: true } },
    customer: { columns: { name: true } },
    createdBy: { columns: { fullName: true } },
    items: {
      columns: { id: true, productId: true, quantity: true, unitPrice: true, lineTotal: true },
      with: { product: { columns: { name: true, sku: true, unit: true } } }
    }
  }
})



  const invoiceIds = rows.map((r) => r.id)
  const pending = new Set<number>()
  if (invoiceIds.length) {
    const open = await db
      .select({ invoiceId: tickets.invoiceId })
      .from(tickets)
      .where(and(eq(tickets.status, 'abierto'), inArray(tickets.invoiceId, invoiceIds)))
    for (const t of open) if (t.invoiceId != null) pending.add(t.invoiceId)
  }

const mapped = rows.map((inv) => ({
  id: inv.id,
  folio: inv.folio,
  storeId: inv.storeId,
  storeCode: inv.store?.code ?? null,
  storeName: inv.store?.name ?? null,
  customerId: inv.customerId,
  customerName: inv.customer?.name ?? null,
  channel: inv.channel,
  status: inv.status,
  paymentMethod: inv.paymentMethod,
  discountPct: inv.discountPct,
  discountAmount: inv.discountAmount,
  totalAmount: inv.totalAmount,
  note: inv.note,
  itemCount: inv.items.length,
  createdByName: inv.createdBy?.fullName ?? null,
  issuedAt: inv.issuedAt,
  voidedAt: inv.voidedAt,
  voidReason: inv.voidReason,
  pendingCorrection: pending.has(inv.id),
  items: inv.items.map((it) => ({
    id: it.id,
    productId: it.productId,
    productName: it.product?.name ?? null,
    productSku: it.product?.sku ?? null,
    unit: it.product?.unit ?? null,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    lineTotal: it.lineTotal
  }))
}))
if (!paginate) return mapped

const [{ value: total }] = await db.select({ value: count() }).from(invoices).where(whereClause)
return { data: mapped, total, page, pageSize }
})


