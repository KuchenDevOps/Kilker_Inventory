// GET /api/sales — historial de ventas (facturas internas).
// Empleado: solo las de SU tienda. Admin: todas (filtro opcional ?storeId).
// Devuelve cabeceras con datos resumidos para el listado.
import { and, desc, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices, tickets } from '../../db/schema'

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

  const rows = await db.query.invoices.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(invoices.issuedAt)],
    limit: 200,
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } },
      items: { columns: { id: true } }
    }
  })

  // Facturas con un ticket de corrección ABIERTO (para mostrar "esperando
  // corrección" en vez de permitir solicitarla de nuevo).
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
