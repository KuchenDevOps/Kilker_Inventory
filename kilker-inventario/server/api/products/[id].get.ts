// ───────────────────────────────────────────────
//  GET /api/products/:id — detalle de un producto
// ───────────────────────────────────────────────
// Campos editables (incluye barcode). Lectura pública; alimenta la pantalla de edición.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { products } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const db = useDb()
  const p = await db.query.products.findFirst({ where: eq(products.id, id) })
  if (!p) throw createError({ statusCode: 404, statusMessage: 'Producto no existe' })

  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    categoryId: p.categoryId,
    color: p.color,
    unit: p.unit,
    price: p.price,
    cost: p.cost,
    barcode: p.barcode,
    minQuantity: p.minQuantity,
    maxQuantity: p.maxQuantity,
    isActive: p.isActive
  }
})
