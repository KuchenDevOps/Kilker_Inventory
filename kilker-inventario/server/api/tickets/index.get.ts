// GET /api/tickets — tickets de corrección.
// Empleado: solo los de SU tienda. Admin: todos (filtro opcional ?status).
import { and, desc, eq } from 'drizzle-orm'
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

  const rows = await db.query.tickets.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(tickets.createdAt)],
    limit: 200,
    with: {
      store: { columns: { code: true, name: true } },
      raisedBy: { columns: { fullName: true } },
      resolvedBy: { columns: { fullName: true } },
      invoice: { columns: { folio: true, status: true, totalAmount: true } }
    }
  })

  return rows.map((t) => ({
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
})
