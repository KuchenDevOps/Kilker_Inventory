// GET /api/categories — categorías/líneas de producto, ordenadas por nombre.
// Lectura pública. Alimenta el selector de categoría del alta de producto y la
// sección de gestión de categorías. Incluye `productCount` y `parentName`
// (aditivos: el selector solo usa id/name/parentId).
import { sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { products } from '../../db/schema'

export default defineEventHandler(async () => {
  const db = useDb()

  const rows = await db.query.categories.findMany({
    orderBy: (c, { asc }) => [asc(c.name)]
  })

  // Conteo de productos por categoría (una sola consulta agregada).
  const counts = await db
    .select({
      categoryId: products.categoryId,
      count: sql<number>`count(*)::int`
    })
    .from(products)
    .groupBy(products.categoryId)
  const countByCategory = new Map<number, number>()
  for (const row of counts) {
    if (row.categoryId != null) countByCategory.set(row.categoryId, row.count)
  }

  const nameById = new Map(rows.map((c) => [c.id, c.name]))

  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    parentName: c.parentId != null ? (nameById.get(c.parentId) ?? null) : null,
    productCount: countByCategory.get(c.id) ?? 0
  }))
})
