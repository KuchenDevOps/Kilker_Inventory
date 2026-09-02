// ───────────────────────────────────────────────
//  POST /api/expenses/:id/payments — registrar un abono
// ───────────────────────────────────────────────
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { expensePayments, expenses, paymentMethod } from '../../../../db/schema'
import { recordPaymentCashFlow, resolvePaymentAccount } from '../../../../utils/cashFlow'

interface NewPaymentBody {
  amount?: number | string
  paidAt?: string
  paidBy?: string
  method?: string
  /** Cuenta bancaria del pago. Obligatoria salvo en efectivo. */
  accountId?: number | string | null
  note?: string
}

// Del enum de la BD (ver nota en movements/:id/payments): copiarlo a mano es lo
// que dejó fuera a 'debito' y 'credito' al partir 'tarjeta'.
const ALLOWED_METHODS = paymentMethod.enumValues

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const expenseId = Number(getRouterParam(event, 'id'))
  if (!expenseId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const body = await readBody<NewPaymentBody>(event)
  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Monto inválido' })
  }
  const paidBy = String(body?.paidBy ?? '').trim()
  if(!paidBy){
    throw createError({ statusCode: 400, statusMessage: 'Coloca la empresa que genero el pago'})
  }
  const paidAt = String(body?.paidAt ?? '').trim()
  if (!paidAt) {
    throw createError({ statusCode: 400, statusMessage: 'La fecha de pago es obligatoria' })
  }
  const method = ALLOWED_METHODS.includes(body?.method as never)
    ? (body!.method as (typeof ALLOWED_METHODS)[number])
    : 'efectivo'
  // NULL = efectivo; un método bancario sin cuenta se rechaza (ver cashFlow.ts).
  const accountId = resolvePaymentAccount(method, body?.accountId)

  const db = useDb()

  // Transacción con el gasto bloqueado ANTES de leer el saldo: sin el candado,
  // dos abonos simultáneos leen el mismo "ya pagado" y el gasto se sobrepaga.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${expenses} WHERE id = ${expenseId} FOR UPDATE`)

    const expense = await tx.query.expenses.findFirst({
      where: eq(expenses.id, expenseId),
      with: { payments: { columns: { amount: true } } }
    })
    if (!expense) throw createError({ statusCode: 404, statusMessage: 'Gasto no existe' })

    if (isStoreScopedRole(profile.role) && expense.storeId !== profile.storeId) {
      throw createError({
        statusCode: 403,
        statusMessage: 'No puedes pagar gastos de otra sucursal'
      })
    }

    // Un gasto anulado no admite abonos: anularlo borró los que tenía y
    // revirtió su movimiento de banco. Un abono nuevo volvería a restar de la
    // cuenta por un gasto que ya no existe.
    if (expense.status === 'anulado') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Este gasto está anulado: no admite pagos'
      })
    }

    // ⚠️ El pagable es `total_to_pay` = subtotal + IVA − retenciones, LEÍDO de
    // la base (es una columna generada). El IVA y las retenciones dejaron de ser
    // informativos: ahora se pagan.
    //
    // Se lee, no se recalcula, y eso es el punto: antes el pagable se derivaba
    // en un lado y la pantalla lo mostraba con otra fórmula, divergieron, y
    // entraron pagos inflados (monto × 1.16) que nadie topó. Con la columna
    // generada hay UNA definición de "cuánto se debe" y la pone Postgres.
    const totalToPay = Number(expense.totalToPay)
    const alreadyPaid = expense.payments.reduce((sum, p) => sum + Number(p.amount), 0)
    const remaining = Math.round((totalToPay - alreadyPaid) * 100) / 100

    if (totalToPay <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Este gasto no tiene importe que pagar'
      })
    }
    if (remaining <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Este gasto ya está pagado por completo'
      })
    }
    // Tolerancia de un centavo por redondeo en el cliente. El tope se aplica en
    // el servidor a propósito: el de la UI se salta con un POST directo.
    if (amount > remaining + 0.01) {
      throw createError({
        statusCode: 400,
        statusMessage:
          `El abono (${amount.toFixed(2)}) excede el saldo pendiente (${remaining.toFixed(2)}). ` +
          `El total a pagar es ${totalToPay.toFixed(2)} (subtotal + IVA − retenciones).`
      })
    }

    const [created] = await tx
      .insert(expensePayments)
      .values({
        expenseId,
        amount: String(amount),
        paidAt,
        paidBy,
        method,
        accountId,
        note: body?.note?.trim() || null,
        createdBy: profile.id
      })
      .returning()
    if (!created) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo registrar el pago' })
    }

    const cashFlow = await recordPaymentCashFlow(tx, {
      source: { kind: 'gasto', expensePaymentId: created.id },
      amount,
      paidAt,
      accountId,
      method,
      storeId: expense.storeId,
      profileId: profile.id,
      note: `Pago gasto ${expense.supplier} ${expense.supplierInvoiceNumber}`
    })

    return { ...created, cashFlow }
  })
})