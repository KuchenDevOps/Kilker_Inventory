// ───────────────────────────────────────────────
//  GET /api/stores — tiendas (lectura pública)
// ───────────────────────────────────────────────
// Ordenadas por código.
import { useDb } from '../../db'

export default defineEventHandler(async () => {
  const db = useDb()
  return db.query.stores.findMany({
    orderBy: (s, { asc }) => [asc(s.code)]
  })
})
