// ───────────────────────────────────────────────
//  GET /api/expenses/:id/payments — pagos de un gasto
// ───────────────────────────────────────────────
import { desc, eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { expensePayments } from '../../../../db/schema'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const expenseId = Number(getRouterParam(event, 'id'))
  if (!expenseId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const db = useDb()
  const rows = await db.query.expensePayments.findMany({
    where: eq(expensePayments.expenseId, expenseId),
    orderBy: [desc(expensePayments.paidAt)],
    with: { createdBy: { columns: { fullName: true } } }
  })

  return rows.map((p) => ({
    id: p.id,
    expenseId: p.expenseId,
    amount: p.amount,
    paidAt: p.paidAt,
    method: p.method,
    note: p.note,
    createdByName: p.createdBy?.fullName ?? null,
    createdAt: p.createdAt
  }))
})