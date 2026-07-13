// ───────────────────────────────────────────────
//  GET /api/sales/:id — detalle de una venta (ticket)
// ───────────────────────────────────────────────
// Empleado: solo ventas de su tienda. Admin: cualquiera.
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices, tickets } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'ID inválido' })
  }

  const db = useDb()

  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: {
      store: { columns: { code: true, name: true } },
      customer: { columns: { name: true } },
      createdBy: { columns: { fullName: true } },
      items: {
        with: {
          product: { columns: { name: true, sku: true, unit: true } }
        }
      }
    }
  })

  if (!invoice) {
    throw createError({ statusCode: 404, statusMessage: 'Venta no existe' })
  }

  // Empleado solo puede ver ventas de su propia tienda.
  if (profile.role === 'empleado' && invoice.storeId !== profile.storeId) {
    throw createError({ statusCode: 403, statusMessage: 'No puedes ver ventas de otra sucursal' })
  }

  const openTicket = await db.query.tickets.findFirst({
    where: and(eq(tickets.invoiceId, invoice.id), eq(tickets.status, 'abierto'))
  })

  return {
    id: invoice.id,
    folio: invoice.folio,
    storeId: invoice.storeId,
    storeCode: invoice.store?.code ?? null,
    storeName: invoice.store?.name ?? null,
    customerId: invoice.customerId,
    customerName: invoice.customer?.name ?? null,
    channel: invoice.channel,
    status: invoice.status,
    paymentMethod: invoice.paymentMethod,
    discountPct: invoice.discountPct,
    discountAmount: invoice.discountAmount,
    totalAmount: invoice.totalAmount,
    note: invoice.note,
    itemCount: invoice.items.length,
    createdByName: invoice.createdBy?.fullName ?? null,
    issuedAt: invoice.issuedAt,
    voidedAt: invoice.voidedAt,
    voidReason: invoice.voidReason,
    pendingCorrection: !!openTicket,
    items: invoice.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productName: it.product?.name ?? null,
      productSku: it.product?.sku ?? null,
      unit: it.product?.unit ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.lineTotal
    }))
  }
})