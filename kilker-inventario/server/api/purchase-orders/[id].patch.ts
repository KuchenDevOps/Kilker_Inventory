// ───────────────────────────────────────────────
//  PATCH /api/purchase-orders/:id — editar un pedido PENDIENTE
//  Cuerpo completo (el modal manda todo). Las líneas se reemplazan enteras:
//  el pedido no mueve nada, así que borrar y reinsertar es seguro.
// ───────────────────────────────────────────────
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { purchaseOrderItems, purchaseOrders, stores } from '../../db/schema'
import { resolveOrderLines } from '../../utils/purchaseOrders'

interface PurchaseOrderBody {
  storeId?: number | null
  supplierName?: string
  supplierContact?: string | null
  note?: string | null
  items?: { productId: number; quantity: number; unitPrice: number }[]
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const body = await readBody<PurchaseOrderBody>(event)
  const supplierName = cleanText(body?.supplierName)
  if (!supplierName) {
    throw createError({ statusCode: 400, statusMessage: 'Indica a qué empresa se le hace el pedido' })
  }
  const lines = await resolveOrderLines(body?.items)

  const db = useDb()
  return await db.transaction(async (tx) => {
    // Leer estado → actuar: se bloquea primero (CLAUDE.md §10.2). Sin esto,
    // una edición y una aprobación simultáneas dejarían aprobado un pedido
    // distinto del que vio quien lo aprobó.
    await tx.execute(sql`SELECT id FROM ${purchaseOrders} WHERE id = ${id} FOR UPDATE`)

    const order = await tx.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) })
    if (!order) throw createError({ statusCode: 404, statusMessage: 'Pedido no existe' })
    assertOwnStore(profile, order.storeId)
    if (order.status !== 'pendiente') {
      throw createError({
        statusCode: 409,
        statusMessage: 'El pedido ya fue aprobado o rechazado: no se puede editar'
      })
    }

    // Solo un rol global puede cambiar la sucursal.
    let storeId = order.storeId
    if (!isStoreScopedRole(profile.role) && body?.storeId) {
      storeId = Number(body.storeId)
      if (storeId !== order.storeId) {
        const store = await tx.query.stores.findFirst({ where: eq(stores.id, storeId) })
        if (!store || !store.isActive) {
          throw createError({ statusCode: 400, statusMessage: 'La sucursal no existe o está desactivada' })
        }
      }
    }

    const [updated] = await tx
      .update(purchaseOrders)
      .set({
        storeId,
        supplierName,
        supplierContact: cleanText(body?.supplierContact),
        note: cleanText(body?.note)
      })
      .where(eq(purchaseOrders.id, id))
      .returning()

    await tx.delete(purchaseOrderItems).where(eq(purchaseOrderItems.orderId, id))
    await tx.insert(purchaseOrderItems).values(lines.map((l) => ({ ...l, orderId: id })))

    return updated
  })
})