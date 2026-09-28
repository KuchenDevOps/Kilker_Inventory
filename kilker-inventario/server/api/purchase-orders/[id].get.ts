// ───────────────────────────────────────────────
//  GET /api/purchase-orders/:id — pedido con sus líneas
// ───────────────────────────────────────────────
import { asc, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { products, purchaseOrderItems, purchaseOrders } from '../../db/schema'
import { purchaseOrdersBaseQuery } from '../../utils/purchaseOrders'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const [order] = await purchaseOrdersBaseQuery().where(eq(purchaseOrders.id, id))
  if (!order) throw createError({ statusCode: 404, statusMessage: 'Pedido no existe' })
  assertOwnStore(profile, order.storeId)

  const items = await useDb()
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      sku: purchaseOrderItems.sku,
      name: purchaseOrderItems.name,
      unit: products.unit,
      quantity: purchaseOrderItems.quantity,
      unitPrice: purchaseOrderItems.unitPrice,
      lineTotal: purchaseOrderItems.lineTotal
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .where(eq(purchaseOrderItems.orderId, id))
    .orderBy(asc(purchaseOrderItems.id))

  return { ...order, items }
})