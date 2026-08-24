// ───────────────────────────────────────────────
//  GET /api/sales/:id/payments — abonos de una venta
// ───────────────────────────────────────────────
import { desc, eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { invoices, salePayments } from '../../../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const invoiceId = Number(getRouterParam(event, 'id'))
  if (!invoiceId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const db = useDb()

  // Se lee la factura antes que los abonos para que el rol acotado solo vea
  // los de su sucursal (mismo criterio que /api/movements/:id/payments).
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
    columns: { id: true, storeId: true }
  })
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Venta no existe' })
  if (isStoreScopedRole(profile.role) && invoice.storeId !== profile.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No puedes ver los pagos de ventas de otra sucursal'
    })
  }

  const rows = await db.query.salePayments.findMany({
    where: eq(salePayments.invoiceId, invoiceId),
    orderBy: [desc(salePayments.paidAt)],
    with: { createdBy: { columns: { fullName: true } } }
  })

  return rows.map((p) => ({
    id: p.id,
    invoiceId: p.invoiceId,
    amount: p.amount,
    paidAt: p.paidAt,
    method: p.method,
    note: p.note,
    createdByName: p.createdBy?.fullName ?? null,
    createdAt: p.createdAt
  }))
})
