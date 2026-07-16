// ───────────────────────────────────────────────
//  POST /api/transfers/:id/cancel — cancelar transferencia en tránsito
// ───────────────────────────────────────────────
// Repone el inventario en el origen (revierte la salida). Solo admin,
// o el empleado de la sucursal origen (quien la creó puede arrepentirse).
import { and, eq, sql } from 'drizzle-orm'
import { useDb } from '../../../db'
import { inventory, stockMovements, transfers } from '../../../db/schema'

interface CancelBody {
  reason?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })
  const body = await readBody<CancelBody>(event).catch(() => ({}) as CancelBody)

  const db = useDb()

  return await db.transaction(async (tx) => {
    const transfer = await tx.query.transfers.findFirst({ where: eq(transfers.id, id) })
    if (!transfer) throw createError({ statusCode: 404, statusMessage: 'Transferencia no existe' })
    if (transfer.status !== 'en_transito') {
      throw createError({
        statusCode: 400,
        statusMessage: `No se puede cancelar una transferencia en estado "${transfer.status}"`
      })
    }

    // Solo admin, o el empleado de la sucursal ORIGEN (quien la despachó).
    if (profile.role === 'empleado' && profile.storeId !== transfer.fromStoreId) {
      throw createError({ statusCode: 403, statusMessage: 'Solo la sucursal origen puede cancelar esta transferencia' })
    }

    const outboundMovs = await tx.query.stockMovements.findMany({
      where: and(eq(stockMovements.transferId, id), eq(stockMovements.type, 'transferencia_salida'))
    })

    for (const m of outboundMovs) {
      const quantity = Math.abs(Number(m.quantity))

      // Reponer el inventario en el origen.
      await tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} + ${quantity}`, updatedAt: new Date() })
        .where(and(eq(inventory.productId, m.productId), eq(inventory.storeId, m.storeId)))

      // Movimiento de reversa, ligado al original.
      await tx.insert(stockMovements).values({
        productId: m.productId,
        storeId: m.storeId,
        type: 'ajuste',
        quantity: String(quantity),
        unitValue: m.unitValue,
        totalValue: String(Number(m.unitValue) * quantity),
        transferId: id,
        reversesMovementId: m.id,
        reason: 'Cancelación de transferencia',
        createdBy: profile.id
      })
    }

    const [updated] = await tx
      .update(transfers)
      .set({
        status: 'cancelada',
        canceledAt: new Date(),
        canceledBy: profile.id,
        cancelReason: body?.reason?.trim() || null
      })
      .where(eq(transfers.id, id))
      .returning()

    return updated
  })
})