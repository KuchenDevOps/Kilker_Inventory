// ───────────────────────────────────────────────
//  POST /api/purchase-orders/:id/decision — aprobar o rechazar
//  admin y admin_tienda (este solo los de su sucursal). Es definitivo.
// ───────────────────────────────────────────────
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../../db'
import { purchaseOrders } from '../../../db/schema'
import { PURCHASE_ORDER_APPROVER_ROLES } from '../../../utils/purchaseOrders'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: PURCHASE_ORDER_APPROVER_ROLES })
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const body = await readBody<{ status?: string; note?: string | null }>(event)
  const status = body?.status
  if (status !== 'aprobado' && status !== 'rechazado') {
    throw createError({ statusCode: 400, statusMessage: "status debe ser 'aprobado' o 'rechazado'" })
  }
  const note = typeof body?.note === 'string' ? body.note.trim() || null : null

  const db = useDb()
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${purchaseOrders} WHERE id = ${id} FOR UPDATE`)

    const order = await tx.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) })
    if (!order) throw createError({ statusCode: 404, statusMessage: 'Pedido no existe' })
    assertOwnStore(profile, order.storeId)
    if (order.status !== 'pendiente') {
      throw createError({ statusCode: 409, statusMessage: 'El pedido ya fue aprobado o rechazado' })
    }

    const [updated] = await tx
      .update(purchaseOrders)
      .set({ status, decidedBy: profile.id, decidedAt: new Date(), decisionNote: note })
      .where(eq(purchaseOrders.id, id))
      .returning()

    return updated
  })
})