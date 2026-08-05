// ───────────────────────────────────────────────
//  GET /api/reports/monthly-inventory
// ───────────────────────────────────────────────
// Envoltorio delgado: la lógica de valuación FIFO vive en
// server/utils/monthlyInventory.ts para poder reusarla desde
// /api/dashboard/summary sin duplicarla.
import { computeMonthlyInventory } from '../../utils/monthlyInventory'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const month = String(query.month ?? '')
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Parámetro month requerido (formato YYYY-MM)'
    })
  }

  const storeId = query.storeId ? Number(query.storeId) || undefined : undefined

  return computeMonthlyInventory({ profile, month, storeId })
})
