// GET /api/products — catálogo con su categoría y stock total (todas las tiendas).
// Lectura pública por ahora (sin auth todavía). Usa el cliente Drizzle en runtime
// (pooler de Supabase). El stock total se deriva sumando `inventory` por producto.
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
    // Saldo materializado: Σ existencias en todas las tiendas.
    totalStock: p.inventory.reduce((sum, i) => sum + Number(i.quantity), 0)
  }))
})
