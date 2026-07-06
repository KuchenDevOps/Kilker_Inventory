// ───────────────────────────────────────────────
//  GET /api/customers — catálogo de clientes
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { customers } from '../../db/schema'

export default defineEventHandler(async () => {
  const db = useDb()
  return await db.query.customers.findMany({
    orderBy: (c, { asc }) => [asc(c.name)]
  })
})