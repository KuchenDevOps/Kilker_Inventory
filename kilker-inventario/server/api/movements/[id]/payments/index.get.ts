// ───────────────────────────────────────────────
//  GET /api/movements/:id/payments — abonos de una entrada
// ───────────────────────────────────────────────
import { desc, eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { entryPayments, stockMovements } from '../../../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const movementId = Number(getRouterParam(event, 'id'))
  if (!movementId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const db = useDb()

  // La FK no puede exigir que sea una entrada; se valida aquí. De paso, el
  // empleado solo ve los abonos de su sucursal.
  const movement = await db.query.stockMovements.findFirst({
    where: eq(stockMovements.id, movementId),
    columns: { id: true, storeId: true, type: true }
  })
  if (!movement || movement.type !== 'entrada') {
    throw createError({ statusCode: 404, statusMessage: 'Entrada no existe' })
  }
  if (profile.role === 'empleado' && movement.storeId !== profile.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No puedes ver los pagos de entradas de otra sucursal'
    })
  }

  const rows = await db.query.entryPayments.findMany({
    where: eq(entryPayments.movementId, movementId),
    orderBy: [desc(entryPayments.paidAt)],
    with: { createdBy: { columns: { fullName: true } } }
  })

  return rows.map((p) => ({
    id: p.id,
    movementId: p.movementId,
    amount: p.amount,
    paidAt: p.paidAt,
    method: p.method,
    note: p.note,
    createdByName: p.createdBy?.fullName ?? null,
    createdAt: p.createdAt
  }))
})
