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
    with: {
      createdBy: { columns: { fullName: true } },
      // ⚠️ `accountId` sale del mapeo manual de abajo. Se devuelve SIEMPRE, junto
      // con la etiqueta: sin él, la pantalla no puede distinguir un pago en
      // efectivo de uno bancario al que todavía no se le asigna cuenta — y los
      // dos se ven igual (null) desde el cliente.
      account: { columns: { bank: true, owner: true, cardLast4: true } }
    }
  })

  return rows.map((p) => ({
    id: p.id,
    expenseId: p.expenseId,
    amount: p.amount,
    paidAt: p.paidAt,
    paidBy: p.paidBy,
    method: p.method,
    accountId: p.accountId,
    accountLabel: p.account
      ? p.account.cardLast4
        ? `${p.account.bank} ···· ${p.account.cardLast4}`
        : `${p.account.bank} · ${p.account.owner}`
      : null,
    note: p.note,
    createdByName: p.createdBy?.fullName ?? null,
    createdAt: p.createdAt
  }))
})