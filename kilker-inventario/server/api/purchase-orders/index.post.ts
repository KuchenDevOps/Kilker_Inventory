// ───────────────────────────────────────────────
//  POST /api/purchase-orders — alta de pedido a proveedor
//  No toca inventario: solo guarda el documento.
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
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
  const body = await readBody<PurchaseOrderBody>(event)

  const supplierName = cleanText(body?.supplierName)
  if (!supplierName) {
    throw createError({ statusCode: 400, statusMessage: 'Indica a qué empresa se le hace el pedido' })
  }

  // Rol acotado → su sucursal, ignora la del body.
  const storeId = resolveTargetStoreId(profile, body?.storeId ? Number(body.storeId) : null)
  if (storeId == null) {
    throw createError({ statusCode: 400, statusMessage: 'Elige la sucursal que hace el pedido' })
  }

  const db = useDb()
  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
  if (!store || !store.isActive) {
    throw createError({ statusCode: 400, statusMessage: 'La sucursal no existe o está desactivada' })
  }

  const lines = await resolveOrderLines(body?.items)

  return await db.transaction(async (tx) => {
    const [order] = await tx
      .insert(purchaseOrders)
      .values({
        storeId,
        createdBy: profile.id,
        supplierName,
        supplierContact: cleanText(body?.supplierContact),
        note: cleanText(body?.note)
      })
      .returning()

    await tx.insert(purchaseOrderItems).values(lines.map((l) => ({ ...l, orderId: order!.id })))

    return order
  })
})