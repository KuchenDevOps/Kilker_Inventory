// ───────────────────────────────────────────────
//  GET /api/customers — catálogo de clientes
// ───────────────────────────────────────────────
import { count } from 'drizzle-orm'
import { useDb } from '../../db'
import { customers } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const db = useDb()

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.customers.findMany({
    orderBy: (c, { asc }) => [asc(c.name)],
    ...(paginate
      ? { limit: pageSize, offset: (page - 1) * pageSize }
      : { limit: 200, offset: 0 })
  })

  if (!paginate) return rows

  const totalCount = (await db.select({ value: count() }).from(customers))[0]?.value ?? 0

  return {
    data: rows,
    total: totalCount,
    page,
    pageSize
  }
})