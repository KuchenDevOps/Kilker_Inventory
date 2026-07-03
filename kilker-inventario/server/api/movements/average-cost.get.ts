// ───────────────────────────────────────────────
//  GET /api/movements/average-cost — costo promedio ponderado histórico
// ───────────────────────────────────────────────
// Agrega TODAS las entradas (type = 'entrada') por producto × sucursal,
// sin límite y sin filtro de periodo: es un costo promedio real, no del
// rango que esté viendo el dashboard.
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { stockMovements } from '../../db/schema'

export default defineEventHandler(async (event) => {
  // Cualquier perfil autenticado puede consultarlo (se usa para valorizar inventario).
  await requireProfile(event)

  const db = useDb()

  const rows = await db
    .select({
      productId: stockMovements.productId,
      storeId: stockMovements.storeId,
      totalQty: sql<string>`SUM(${stockMovements.quantity}::numeric)`.as('totalQty'),
      avgCost: sql<string>`
        SUM(${stockMovements.quantity}::numeric * ${stockMovements.unitValue}::numeric)
        / NULLIF(SUM(${stockMovements.quantity}::numeric), 0)
      `.as('avgCost')
    })
    .from(stockMovements)
    .where(eq(stockMovements.type, 'entrada'))
    .groupBy(stockMovements.productId, stockMovements.storeId)

  return rows.map((r) => ({
    productId: r.productId,
    storeId: r.storeId,
    totalQty: Number(r.totalQty),
    avgCost: Number(r.avgCost ?? 0)
  }))
})