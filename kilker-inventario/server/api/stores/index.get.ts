// GET /api/stores — tiendas/sucursales, ordenadas por código.
// Lectura pública por ahora (sin auth todavía).
import { useDb } from '../../db'

export default defineEventHandler(async () => {
  const db = useDb()
  return db.query.stores.findMany({
    orderBy: (s, { asc }) => [asc(s.code)]
  })
})
