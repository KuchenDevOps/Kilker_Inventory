// ───────────────────────────────────────────────
//  GET /api/tickets — tickets de corrección
// ───────────────────────────────────────────────
// Empleado: su tienda. Admin: todos (filtro ?status).
import { and, count, desc, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { tickets } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  const filters = []
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(eq(tickets.storeId, profile.storeId))
  }
  if (
    query.status === 'abierto' ||
    query.status === 'aprobado' ||
    query.status === 'rechazado'
  ) {
    filters.push(eq(tickets.status, query.status))
  }

  const where = filters.length ? and(...filters) : undefined

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

const rows = await db.query.tickets.findMany({
    where,
    orderBy: [desc(tickets.createdAt)],
    ...(paginate
      ? { limit: pageSize, offset: (page - 1) * pageSize }
      : { limit: 200, offset: 0 }),
    with: {
      store: { columns: { code: true, name: true } },
      raisedBy: { columns: { fullName: true } },
      resolvedBy: { columns: { fullName: true } },
      invoice: { columns: { folio: true, status: true, totalAmount: true } }
    }
  })

  const mapped = rows.map((t) => ({
    id: t.id,
    target: t.target,
    status: t.status,
    reason: t.reason,
    storeId: t.storeId,
    storeCode: t.store?.code ?? null,
    invoiceId: t.invoiceId,
    invoiceFolio: t.invoice?.folio ?? null,
    invoiceStatus: t.invoice?.status ?? null,
    invoiceTotal: t.invoice?.totalAmount ?? null,
    raisedByName: t.raisedBy?.fullName ?? null,
    resolvedByName: t.resolvedBy?.fullName ?? null,
    resolutionNote: t.resolutionNote,
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt
  }))

  if (!paginate) return mapped

  const [{ value: totalCount }] = await db
    .select({ value: count() })
    .from(tickets)
    .where(where)

  return {
    data: mapped,
    total: totalCount,
    page,
    pageSize
  }
})