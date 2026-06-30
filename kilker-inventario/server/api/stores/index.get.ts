// ───────────────────────────────────────────────
//  GET /api/stores — tiendas (lectura pública)
// ───────────────────────────────────────────────
// Ordenadas por código; enriquecidas con employeeCount (nº de empleados).
import { sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { profiles } from '../../db/schema'

export default defineEventHandler(async () => {
  const db = useDb()

  const rows = await db.query.stores.findMany({
    orderBy: (s, { asc }) => [asc(s.code)]
  })

  // Conteo de empleados (profiles) por sucursal.
  const counts = await db
    .select({ storeId: profiles.storeId, count: sql<number>`count(*)::int` })
    .from(profiles)
    .groupBy(profiles.storeId)
  const countByStore = new Map<number, number>()
  for (const row of counts) {
    if (row.storeId != null) countByStore.set(row.storeId, row.count)
  }

  return rows.map((s) => ({ ...s, employeeCount: countByStore.get(s.id) ?? 0 }))
})
