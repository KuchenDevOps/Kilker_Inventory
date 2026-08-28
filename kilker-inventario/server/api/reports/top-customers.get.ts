// ───────────────────────────────────────────────
//  GET /api/reports/top-customers — clientes con más compras + costo/utilidad FIFO
// ───────────────────────────────────────────────
// Envoltorio delgado, igual que top-products: la lógica (y su caché) vive en
// server/utils/topCustomers.ts.
import { computeTopCustomers } from '../../utils/topCustomers'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  return computeTopCustomers({
    profile,
    storeId: query.storeId ? Number(query.storeId) || undefined : undefined,
    from: query.from ? String(query.from) : undefined,
    to: query.to ? String(query.to) : undefined,
    limit: query.limit != null ? Number(query.limit) : 5
  })
})
