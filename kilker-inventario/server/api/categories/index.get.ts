// GET /api/categories — categorías/líneas de producto, ordenadas por nombre.
// Lectura pública por ahora (sin auth todavía); alimenta el selector de categoría
// en el alta de producto.
import { useDb } from '../../db'

export default defineEventHandler(async () => {
  const db = useDb()
  const rows = await db.query.categories.findMany({
    orderBy: (c, { asc }) => [asc(c.name)]
  })
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId
  }))
})
