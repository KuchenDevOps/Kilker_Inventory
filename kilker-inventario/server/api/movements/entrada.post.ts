// ───────────────────────────────────────────────
//  POST /api/movements/entrada — entrada de stock (admin o empleado)
// ───────────────────────────────────────────────
// En transacción: inserta el movimiento y sube inventory por (producto × tienda).
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { inventory, products, stockMovements } from '../../db/schema'

interface EntradaBody {
  productId: number
  storeId: number
  quantity: number
  reason?: string
  supplierInvoiceNumber?: string
  supplierInvoiceDate?: string
}

export default defineEventHandler(async (event) => {
  // Admin y empleado pueden registrar entradas.
  const profile = await requireProfile(event)
  const body = await readBody<EntradaBody>(event)

  const productId = Number(body?.productId)
  // Admin elige la tienda desde el body; el empleado siempre usa la suya.
  const storeId =
    profile.role === 'admin' ? Number(body?.storeId) : Number(profile.storeId)
  const quantity = Number(body?.quantity)
  if (!productId || !storeId || !(quantity > 0)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        profile.role === 'admin'
          ? 'productId, storeId y quantity (>0) son requeridos'
          : 'productId y quantity (>0) son requeridos; tu perfil debe tener una sucursal asignada'
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

    // Costo estándar del producto (sin captura manual por entrada).
    const unitValue = Number(product.cost ?? 0)
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
        supplierInvoiceNumber: body.supplierInvoiceNumber?.trim() || null,
        supplierInvoiceDate: body.supplierInvoiceDate || null,
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
