// POST /api/movements/entrada — entrada de stock (solo admin).
// Inserta un stock_movements(entrada, +cantidad) y sube `inventory` por
// (producto × tienda), todo en UNA transacción Drizzle.
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { inventory, products, stockMovements } from '../../db/schema'

interface EntradaBody {
  productId: number
  storeId: number
  quantity: number
  unitValue?: number
  reason?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: 'admin' })
  const body = await readBody<EntradaBody>(event)

  const productId = Number(body?.productId)
  const storeId = Number(body?.storeId)
  const quantity = Number(body?.quantity)
  if (!productId || !storeId || !(quantity > 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'productId, storeId y quantity (>0) son requeridos'
    })
  }

  const db = useDb()

  return await db.transaction(async (tx) => {
    const product = await tx.query.products.findFirst({
      where: eq(products.id, productId)
    })
    if (!product) {
      throw createError({ statusCode: 404, statusMessage: 'Producto no existe' })
    }

    const unitValue = body.unitValue != null ? Number(body.unitValue) : Number(product.cost ?? 0)
    const totalValue = quantity * unitValue

    const [movement] = await tx
      .insert(stockMovements)
      .values({
        productId,
        storeId,
        type: 'entrada',
        quantity: String(quantity),
        unitValue: String(unitValue),
        totalValue: String(totalValue),
        reason: body.reason ?? null,
        createdBy: profile.id
      })
      .returning()

    await tx
      .insert(inventory)
      .values({ productId, storeId, quantity: String(quantity) })
      .onConflictDoUpdate({
        target: [inventory.productId, inventory.storeId],
        set: {
          quantity: sql`${inventory.quantity} + ${quantity}`,
          updatedAt: new Date()
        }
      })

    const inv = await tx.query.inventory.findFirst({
      where: (i, { and, eq: eqi }) => and(eqi(i.productId, productId), eqi(i.storeId, storeId))
    })

    return { movement, inventory: inv }
  })
})
