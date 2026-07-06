// ───────────────────────────────────────────────
//  GET /api/sales — historial de ventas
// ───────────────────────────────────────────────
// Empleado: su tienda. Admin: todas (filtros ?storeId/?status).
import { and, desc, eq, gte, ilike, inArray, lt, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { customers, invoices, profiles, stores, tickets } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  // Filtro por tienda: forzado para empleado; opcional para admin.
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

  // Rango de fechas (issued_at): from inclusivo, to exclusivo.
  if (query.from) filters.push(gte(invoices.issuedAt, new Date(String(query.from))))
  if (query.to) filters.push(lt(invoices.issuedAt, new Date(String(query.to))))

  // Búsqueda ?q: folio, método de pago, sucursal (name/code), empleado que emitió, cliente.
  const q = String(query.q ?? '').trim()
  if (q) {
    const like = `%${q}%`
    const [storeIds, profIds, customerIds] = await Promise.all([
      db
        .select({ id: stores.id })
        .from(stores)
        .where(or(ilike(stores.name, like), ilike(stores.code, like))),
      db.select({ id: profiles.id }).from(profiles).where(ilike(profiles.fullName, like)),
      db.select({ id: customers.id }).from(customers).where(ilike(customers.name, like))
    ])

    const orParts = [ilike(invoices.folio, like)]
    const pm = q.toLowerCase()
    for (const m of ['efectivo', 'tarjeta', 'transferencia'] as const) {
      if (m.includes(pm)) orParts.push(eq(invoices.paymentMethod, m))
    }
    if (storeIds.length) {
      orParts.push(inArray(invoices.storeId, storeIds.map((r) => r.id)))
    }
    if (profIds.length) {
      orParts.push(inArray(invoices.createdBy, profIds.map((r) => r.id)))
    }
    if (customerIds.length) {
      orParts.push(inArray(invoices.customerId, customerIds.map((r) => r.id)))
    }
    filters.push(or(...orParts)!)
  }

  const rows = await db.query.invoices.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(invoices.issuedAt)],
    limit: 200,
    with: {
      store: { columns: { code: true, name: true } },
      customer: { columns: { name: true } },
      createdBy: { columns: { fullName: true } },
      items: { columns: { id: true } }
    }
  })

  // Facturas con ticket abierto (marca "esperando corrección").
  const invoiceIds = rows.map((r) => r.id)
  const pending = new Set<number>()
  if (invoiceIds.length) {
    const open = await db
      .select({ invoiceId: tickets.invoiceId })
      .from(tickets)
      .where(and(eq(tickets.status, 'abierto'), inArray(tickets.invoiceId, invoiceIds)))
    for (const t of open) if (t.invoiceId != null) pending.add(t.invoiceId)
  }

  return rows.map((inv) => ({
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
    totalAmount: inv.totalAmount,
    note: inv.note,
    itemCount: inv.items.length,
    createdByName: inv.createdBy?.fullName ?? null,
    issuedAt: inv.issuedAt,
    voidedAt: inv.voidedAt,
    voidReason: inv.voidReason,
    pendingCorrection: pending.has(inv.id)
  }))
})