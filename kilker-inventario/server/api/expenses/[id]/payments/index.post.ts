// ───────────────────────────────────────────────
//  POST /api/expenses/:id/payments — registrar un abono
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { expensePayments, expenses } from '../../../../db/schema'

interface NewPaymentBody {
  amount?: number | string
  paidAt?: string
  method?: string
  note?: string
}

const ALLOWED_METHODS = ['efectivo', 'tarjeta', 'transferencia'] as const

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const expenseId = Number(getRouterParam(event, 'id'))
  if (!expenseId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const body = await readBody<NewPaymentBody>(event)
  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Monto inválido' })
  }
  const paidAt = String(body?.paidAt ?? '').trim()
  if (!paidAt) {
    throw createError({ statusCode: 400, statusMessage: 'La fecha de pago es obligatoria' })
  }
  const method = ALLOWED_METHODS.includes(body?.method as never)
    ? (body!.method as (typeof ALLOWED_METHODS)[number])
    : 'efectivo'

  const db = useDb()

  const expense = await db.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
    with: { payments: { columns: { amount: true } } }
  })
  if (!expense) throw createError({ statusCode: 404, statusMessage: 'Gasto no existe' })

  if (profile.role === 'empleado' && expense.storeId !== profile.storeId) {
    throw createError({ statusCode: 403, statusMessage: 'No puedes pagar gastos de otra sucursal' })
  }

  // No permitir sobrepagar el saldo pendiente.
  const totalToPay =
    Number(expense.amount) * 1.16 - Number(expense.retentionIva ?? 0) - Number(expense.retentionIsr ?? 0)
  const alreadyPaid = expense.payments.reduce((sum, p) => sum + Number(p.amount), 0)
  const remaining = Math.round((totalToPay - alreadyPaid) * 100) / 100
  if (amount > remaining + 0.01) {
    throw createError({
      statusCode: 400,
      statusMessage: `El monto excede el saldo pendiente (${remaining.toFixed(2)})`
    })
  }

  const [created] = await db
    .insert(expensePayments)
    .values({
      expenseId,
      amount: String(amount),
      paidAt,
      method,
      note: body?.note?.trim() || null,
      createdBy: profile.id
    })
    .returning()

  return created
})