// ───────────────────────────────────────────────
//  PATCH /api/movements/:id — editar una entrada de stock (solo admin)
// ───────────────────────────────────────────────
// Permite editar cualquier campo, incluyendo producto y sucursal.
// Si cambia producto/sucursal, revierte el efecto anterior en inventory
// y aplica el nuevo. Si solo cambia la cantidad (mismo producto/tienda),
// aplica la diferencia (delta). Rechaza si el resultado dejaría stock negativo.
import { and, eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { inventory, products, stockMovements, stores } from '../../db/schema'

interface EntradaUpdateBody {
  productId?: number
  storeId?: number
  quantity?: number
  unitValue?: number
  reason?: string | null
  supplierInvoiceNumber?: string | null
  supplierInvoiceDate?: string | null
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  if (profile.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Solo un administrador puede editar entradas' })
  }

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const body = await readBody<EntradaUpdateBody>(event)
  const db = useDb()

  return await db.transaction(async (tx) => {
    const existing = await tx.query.stockMovements.findFirst({
      where: eq(stockMovements.id, id)
    })
    if (!existing || existing.type !== 'entrada') {
      throw createError({ statusCode: 404, statusMessage: 'Entrada no encontrada' })
    }

    const newProductId = body.productId != null ? Number(body.productId) : existing.productId
    const newStoreId = body.storeId != null ? Number(body.storeId) : existing.storeId
    const newQuantity = body.quantity != null ? Number(body.quantity) : Number(existing.quantity)
    const newUnitValue = body.unitValue != null ? Number(body.unitValue) : Number(existing.unitValue)

    if (!newProductId || !newStoreId || !(newQuantity > 0)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'productId, storeId y quantity (>0) son requeridos'
      })
    }

    const product = await tx.query.products.findFirst({ where: eq(products.id, newProductId) })
    if (!product) throw createError({ statusCode: 404, statusMessage: 'Producto no existe' })

    const oldProductId = existing.productId
    const oldStoreId = existing.storeId
    const oldQuantity = Number(existing.quantity)
    const sameTarget = oldProductId === newProductId && oldStoreId === newStoreId

    // Solo exigimos sucursal activa si de verdad se está moviendo hacia otra
    // (una entrada ya existente en una sucursal ahora inactiva puede seguir editándose in situ).
    if (!sameTarget) {
      const store = await tx.query.stores.findFirst({ where: eq(stores.id, newStoreId) })
      if (!store) throw createError({ statusCode: 404, statusMessage: 'Sucursal no existe' })
      if (!store.isActive) {
        throw createError({ statusCode: 400, statusMessage: 'La sucursal destino está inactiva' })
      }
    }

    if (sameTarget) {
      // Mismo producto/tienda: solo aplicamos la diferencia de cantidad.
      const delta = newQuantity - oldQuantity
      if (delta !== 0) {
        const invRow = await tx.query.inventory.findFirst({
          where: (i, { and: andi, eq: eqi }) =>
            andi(eqi(i.productId, oldProductId), eqi(i.storeId, oldStoreId))
        })
        const resultingQty = Number(invRow?.quantity ?? 0) + delta
        if (resultingQty < 0) {
          throw createError({
            statusCode: 400,
            statusMessage:
              'La existencia resultante sería negativa; revisa las ventas registradas después de esta entrada'
          })
        }
        await tx
          .update(inventory)
          .set({ quantity: sql`${inventory.quantity} + ${delta}`, updatedAt: new Date() })
          .where(and(eq(inventory.productId, oldProductId), eq(inventory.storeId, oldStoreId)))
      }
    } else {
      // Producto o tienda distintos: revertimos del origen y aplicamos en el nuevo destino.
      const oldInvRow = await tx.query.inventory.findFirst({
        where: (i, { and: andi, eq: eqi }) =>
          andi(eqi(i.productId, oldProductId), eqi(i.storeId, oldStoreId))
      })
      const oldResulting = Number(oldInvRow?.quantity ?? 0) - oldQuantity
      if (oldResulting < 0) {
        throw createError({
          statusCode: 400,
          statusMessage:
            'No se puede mover la entrada: la existencia del producto/sucursal original quedaría negativa'
        })
      }
      await tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} - ${oldQuantity}`, updatedAt: new Date() })
        .where(and(eq(inventory.productId, oldProductId), eq(inventory.storeId, oldStoreId)))

      await tx
        .insert(inventory)
        .values({ productId: newProductId, storeId: newStoreId, quantity: String(newQuantity) })
        .onConflictDoUpdate({
          target: [inventory.productId, inventory.storeId],
          set: { quantity: sql`${inventory.quantity} + ${newQuantity}`, updatedAt: new Date() }
        })
    }

    const newTotalValue = newQuantity * newUnitValue

    const [updated] = await tx
      .update(stockMovements)
      .set({
        productId: newProductId,
        storeId: newStoreId,
        quantity: String(newQuantity),
        unitValue: String(newUnitValue),
        totalValue: String(newTotalValue),
        reason: body.reason !== undefined ? (body.reason?.trim() || null) : existing.reason,
        supplierInvoiceNumber:
          body.supplierInvoiceNumber !== undefined
            ? body.supplierInvoiceNumber?.trim() || null
            : existing.supplierInvoiceNumber,
        supplierInvoiceDate:
          body.supplierInvoiceDate !== undefined
            ? body.supplierInvoiceDate || null
            : existing.supplierInvoiceDate
      })
      .where(eq(stockMovements.id, id))
      .returning()

    return { movement: updated }
  })
})