// ───────────────────────────────────────────────
//  GET /api/products — catálogo (lectura pública)
// ───────────────────────────────────────────────
// Con categoría y stock total (suma de inventory en todas las tiendas).
import { count } from 'drizzle-orm'
import { useDb } from '../../db'
import { products } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const db = useDb()

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.products.findMany({
    with: {
      category: { columns: { id: true, name: true } },
      inventory: { columns: { storeId: true, quantity: true } }
    },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
   ...(paginate
  ? { limit: pageSize, offset: (page - 1) * pageSize }
  : {})
  })

  const mapped = rows.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category?.name ?? null,
    categoryId: p.categoryId,
    color: p.color,
    unit: p.unit,
    price: p.price,
    cost: p.cost,
    minQuantity: p.minQuantity,
    maxQuantity: p.maxQuantity,
    isActive: p.isActive,
    totalStock: p.inventory.reduce((sum, i) => sum + Number(i.quantity), 0),
    byStore: p.inventory.map((i) => ({ storeId: i.storeId, quantity: Number(i.quantity) }))
  }))

  if (!paginate) return mapped

  const totalCount = (await db.select({ value: count() }).from(products))[0]?.value ?? 0

  return {
    data: mapped,
    total: totalCount,
    page,
    pageSize
  }
})