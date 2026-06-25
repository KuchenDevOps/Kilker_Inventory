// ───────────────────────────────────────────────
//  GET /api/products — catálogo (lectura pública)
// ───────────────────────────────────────────────
// Con categoría y stock total (suma de inventory en todas las tiendas).
import { useDb } from '../../db'

export default defineEventHandler(async () => {
  const db = useDb()

  const rows = await db.query.products.findMany({
    with: {
      category: { columns: { id: true, name: true } },
      inventory: { columns: { storeId: true, quantity: true } }
    },
    orderBy: (p, { desc }) => [desc(p.createdAt)]
  })

  return rows.map((p) => ({
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
    isActive: p.isActive,
    // Σ existencias en todas las tiendas.
    totalStock: p.inventory.reduce((sum, i) => sum + Number(i.quantity), 0)
  }))
})
