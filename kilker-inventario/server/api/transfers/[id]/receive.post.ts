// ───────────────────────────────────────────────
//  POST /api/transfers/:id/receive — confirmar recepción
// ───────────────────────────────────────────────
// Solo se puede recibir una transferencia 'en_transito'. Suma el inventario
// en la sucursal destino y genera los movimientos 'transferencia_entrada'.
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../../db'
import { inventory, stockMovements, transferItems, transfers } from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const db = useDb()

  return await db.transaction(async (tx) => {
    const transfer = await tx.query.transfers.findFirst({
      where: eq(transfers.id, id),
      with: { items: true }
    })
    if (!transfer) throw createError({ statusCode: 404, statusMessage: 'Transferencia no existe' })
    if (transfer.status !== 'en_transito') {
      throw createError({ statusCode: 400, statusMessage: `No se puede recibir una transferencia en estado "${transfer.status}"` })
    }

    // Solo la sucursal destino (o admin) puede confirmar la recepción.
    if (profile.role === 'empleado' && profile.storeId !== transfer.toStoreId) {
      throw createError({ statusCode: 403, statusMessage: 'Solo la sucursal destino puede recibir esta transferencia' })
    }

    for (const item of transfer.items) {
      // Recupera el unitValue usado en la salida, para mantener el mismo costo en la entrada.
      const outbound = await tx.query.stockMovements.findFirst({
        where: (m, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(m.transferId, transfer.id), eqOp(m.productId, item.productId), eqOp(m.type, 'transferencia_salida'))
      })
      const unitValue = Number(outbound?.unitValue ?? 0)
      const quantity = Number(item.quantity)

      await tx.insert(stockMovements).values({
        productId: item.productId,
        storeId: transfer.toStoreId,
        type: 'transferencia_entrada',
        quantity: String(quantity),
        unitValue: String(unitValue),
        totalValue: String(unitValue * quantity),
        transferId: transfer.id,
        createdBy: profile.id
      })

      await tx
        .insert(inventory)
        .values({ productId: item.productId, storeId: transfer.toStoreId, quantity: String(quantity) })
        .onConflictDoUpdate({
          target: [inventory.productId, inventory.storeId],
          set: { quantity: sql`${inventory.quantity} + ${quantity}`, updatedAt: new Date() }
        })
    }

    const [updated] = await tx
    .update(transfers)
    .set({ status: 'recibida', receivedAt: new Date(),  receivedBy: profile.id  })
    .where(eq(transfers.id, id))
    .returning()

  return updated
  })
})