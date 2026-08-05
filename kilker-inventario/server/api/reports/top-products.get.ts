// ───────────────────────────────────────────────
//  GET /api/reports/top-products — productos más vendidos + costo/utilidad FIFO
// ───────────────────────────────────────────────
// Envoltorio delgado: la lógica (y su caché) vive en
// server/utils/topProducts.ts para poder reusarla desde
// /api/dashboard/summary sin duplicar el costeo.
import { computeTopProducts } from '../../utils/topProducts'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  return computeTopProducts({
    profile,
    storeId: query.storeId ? Number(query.storeId) || undefined : undefined,
    from: query.from ? String(query.from) : undefined,
    to: query.to ? String(query.to) : undefined,
    limit: query.limit != null ? Number(query.limit) : 5,
    includeUnsold: query.includeUnsold === 'true'
  })
})
