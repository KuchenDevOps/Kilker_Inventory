// ───────────────────────────────────────────────
//  POST /api/movements/:id/void — anular una entrada de stock
// ───────────────────────────────────────────────
// Solo admin. Resta la cantidad del inventario (si hay suficiente disponible)
// y registra un movimiento 'anulacion' ligado al original.
import { and, eq, sql } from 'drizzle-orm'
import { useDb } from '../../../db'
import { inventory, stockMovements } from '../../../db/schema'

interface VoidBody {
  reason?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: 'admin' })
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const body = await readBody<VoidBody>(event).catch(() => ({}) as VoidBody)

  const db = useDb()

  return await db.transaction(async (tx) => {
    const movement = await tx.query.stockMovements.findFirst({
      where: eq(stockMovements.id, id)
    })
    if (!movement) throw createError({ statusCode: 404, statusMessage: 'Movimiento no existe' })
    if (movement.type !== 'entrada') {
      throw createError({ statusCode: 400, statusMessage: 'Solo se pueden anular movimientos de tipo "entrada"' })
    }

    // ¿Ya fue anulada antes? Evita anular dos veces el mismo movimiento.
    const existingReversal = await tx.query.stockMovements.findFirst({
      where: eq(stockMovements.reversesMovementId, id)
    })
    if (existingReversal) {
      throw createError({ statusCode: 400, statusMessage: 'Esta entrada ya fue anulada' })
    }

    const quantity = Number(movement.quantity) // positivo, ya que es una entrada

    const inv = await tx.query.inventory.findFirst({
      where: and(eq(inventory.productId, movement.productId), eq(inventory.storeId, movement.storeId))
    })
    const available = inv ? Number(inv.quantity) : 0
    if (available < quantity) {
      throw createError({
        statusCode: 400,
        statusMessage: `No se puede anular: solo hay ${available} disponible(s), pero la entrada fue de ${quantity}. Es probable que parte de este stock ya se haya vendido o transferido.`
      })
    }

    await tx.insert(stockMovements).values({
      productId: movement.productId,
      storeId: movement.storeId,
      type: 'anulacion',
      quantity: String(-quantity),
      unitValue: movement.unitValue,
      totalValue: String(-Number(movement.totalValue)),
      reversesMovementId: movement.id,
      reason: body?.reason?.trim() || 'Anulación de entrada',
      createdBy: profile.id
    })

    await tx
      .update(inventory)
      .set({ quantity: sql`${inventory.quantity} - ${quantity}`, updatedAt: new Date() })
      .where(and(eq(inventory.productId, movement.productId), eq(inventory.storeId, movement.storeId)))

    return { ok: true }
  })
})