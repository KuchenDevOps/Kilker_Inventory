// GET /api/sales/:id — detalle de una venta (cabecera + líneas con producto).
// Empleado: solo si la venta es de su tienda. Admin: cualquiera.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const db = useDb()
  const inv = await db.query.invoices.findFirst({
    where: eq(invoices.id, id),
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } },
      voidedBy: { columns: { fullName: true } },
      items: {
        with: { product: { columns: { sku: true, name: true, unit: true } } }
      }
    }
  })
  if (!inv) throw createError({ statusCode: 404, statusMessage: 'Venta no existe' })

  if (profile.role === 'empleado' && profile.storeId !== inv.storeId) {
    throw createError({ statusCode: 403, statusMessage: 'Venta de otra tienda' })
  }

  return {
    id: inv.id,
    folio: inv.folio,
    storeId: inv.storeId,
    storeCode: inv.store?.code ?? null,
    storeName: inv.store?.name ?? null,
    status: inv.status,
    totalAmount: inv.totalAmount,
    note: inv.note,
    createdByName: inv.createdBy?.fullName ?? null,
    issuedAt: inv.issuedAt,
    voidedAt: inv.voidedAt,
    voidReason: inv.voidReason,
    voidedByName: inv.voidedBy?.fullName ?? null,
    items: inv.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      sku: it.product?.sku ?? null,
      name: it.product?.name ?? null,
      unit: it.product?.unit ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      lineTotal: it.lineTotal
    }))
  }
})
