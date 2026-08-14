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

  // Opcionales: acotan la ventana de valuación a un rango concreto (`to`
  // EXCLUSIVO) para cortar "hasta el día X" en vez de al fin de mes. Sin
  // ellos, el comportamiento es el de siempre: el mes completo.
  const from = query.from ? String(query.from) : undefined
  const to = query.to ? String(query.to) : undefined
  for (const [name, value] of [['from', from], ['to', to]] as const) {
    if (value && Number.isNaN(new Date(value).getTime())) {
      throw createError({ statusCode: 400, statusMessage: `Parámetro ${name} inválido` })
    }
  }

  return computeMonthlyInventory({ profile, month, storeId, from, to })
})
