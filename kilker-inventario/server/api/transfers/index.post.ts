// ───────────────────────────────────────────────
//  POST /api/transfers — crear transferencia entre sucursales
// ───────────────────────────────────────────────
// Descuenta inventario de la sucursal origen de inmediato (movimiento
// 'transferencia_salida') y deja la transferencia en estado 'en_transito'.
// El inventario destino se suma solo al recibirla (ver /api/transfers/:id/receive).
import { and, eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { inventory, products, stockMovements, stores, transferItems, transfers } from '../../db/schema'

interface TransferItem {
  productId: number
  quantity: number
}
interface TransferBody {
  fromStoreId: number
  toStoreId: number
  note?: string
    issuedAt?: string
  items: TransferItem[]
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const body = await readBody<TransferBody>(event)

  const fromStoreId = Number(body?.fromStoreId)
  const toStoreId = Number(body?.toStoreId)
  const items = Array.isArray(body?.items) ? body.items : []

  if (!fromStoreId || !toStoreId) {
    throw createError({ statusCode: 400, statusMessage: 'fromStoreId y toStoreId son requeridos' })
  }
  if (fromStoreId === toStoreId) {
    throw createError({ statusCode: 400, statusMessage: 'La sucursal origen y destino no pueden ser la misma' })
  }
  if (items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Agrega al menos un producto' })
  }
  for (const it of items) {
    if (!Number(it.productId) || !(Number(it.quantity) > 0)) {
      throw createError({ statusCode: 400, statusMessage: 'Cada item requiere productId y quantity (>0)' })
    }
  }

  // El empleado solo puede transferir DESDE su propia sucursal.
  if (profile.role === 'empleado' && profile.storeId !== fromStoreId) {
    throw createError({ statusCode: 403, statusMessage: 'Solo puedes transferir desde tu sucursal' })
  }
   let issuedAt: Date | undefined
  if (body.issuedAt) {
    const parsed = new Date(body.issuedAt)
    if (Number.isNaN(parsed.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'issuedAt inválido' })
    }
    if (parsed.getTime() > Date.now()) {
      throw createError({ statusCode: 400, statusMessage: 'issuedAt no puede ser una fecha futura' })
    }
    issuedAt = parsed
  }

  const db = useDb()

  return await db.transaction(async (tx) => {
    const [fromStore, toStore] = await Promise.all([
      tx.query.stores.findFirst({ where: eq(stores.id, fromStoreId) }),
      tx.query.stores.findFirst({ where: eq(stores.id, toStoreId) })
    ])
    if (!fromStore) throw createError({ statusCode: 404, statusMessage: 'Sucursal origen no existe' })
    if (!toStore) throw createError({ statusCode: 404, statusMessage: 'Sucursal destino no existe' })
    if (!fromStore.isActive) throw createError({ statusCode: 400, statusMessage: 'La sucursal origen está inactiva' })
    if (!toStore.isActive) throw createError({ statusCode: 400, statusMessage: 'La sucursal destino está inactiva' })

    // Validar stock disponible y resolver el costo unitario (para valuar la transferencia).
    const lines: { productId: number; quantity: number; unitValue: number }[] = []
    for (const it of items) {
      const productId = Number(it.productId)
      const quantity = Number(it.quantity)
      const product = await tx.query.products.findFirst({ where: eq(products.id, productId) })
      if (!product) throw createError({ statusCode: 404, statusMessage: `Producto ${productId} no existe` })

      const inv = await tx.query.inventory.findFirst({
        where: and(eq(inventory.productId, productId), eq(inventory.storeId, fromStoreId))
      })
      const available = inv ? Number(inv.quantity) : 0
      if (available < quantity) {
        throw createError({
          statusCode: 400,
          statusMessage: `Stock insuficiente de ${product.sku} en ${fromStore.code}: hay ${available}, se piden ${quantity}`
        })
      }
      lines.push({ productId, quantity, unitValue: Number(product.cost ?? 0) })
    }

    const [transfer] = await tx
      .insert(transfers)
      .values({
        fromStoreId,
        toStoreId,
        status: 'en_transito',
        createdBy: profile.id,
        note: body.note?.trim() || null,
        ...(issuedAt ? { issuedAt } : {}) // si no viene, usa el defaultNow()

      })
      .returning()
    if (!transfer) throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la transferencia' })

    for (const l of lines) {
      await tx.insert(transferItems).values({
        transferId: transfer.id,
        productId: l.productId,
        quantity: String(l.quantity)
      })

      // Movimiento de salida en el origen (descuenta inventario ahí mismo).
      await tx.insert(stockMovements).values({
        productId: l.productId,
        storeId: fromStoreId,
        type: 'transferencia_salida',
        quantity: String(-l.quantity),
        unitValue: String(l.unitValue),
        totalValue: String(-l.unitValue * l.quantity),
        transferId: transfer.id,
        createdBy: profile.id
      })

      await tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} - ${l.quantity}`, updatedAt: new Date() })
        .where(and(eq(inventory.productId, l.productId), eq(inventory.storeId, fromStoreId)))
    }

    return transfer
  })
})