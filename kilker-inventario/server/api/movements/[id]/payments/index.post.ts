// ───────────────────────────────────────────────
//  POST /api/movements/:id/payments — registrar un abono de una entrada
// ───────────────────────────────────────────────

import { and, eq, sql } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { entryPayments, paymentMethod, stockMovements } from '../../../../db/schema'
import { recordPaymentCashFlow, resolvePaymentAccount } from '../../../../utils/cashFlow'

interface NewPaymentBody {
  amount?: number | string
  paidAt?: string
  method?: string
  /** Cuenta bancaria del pago. Obligatoria salvo en efectivo. */
  accountId?: number | string | null
  note?: string
}

// Del enum de la BD, no una copia a mano: al partir 'tarjeta' en débito/crédito
// las listas hardcodeadas de este archivo y de sales/expenses se quedaron viejas
// y rechazaban en silencio los métodos nuevos.
const ALLOWED_METHODS = paymentMethod.enumValues

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const movementId = Number(getRouterParam(event, 'id'))
  if (!movementId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

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
  // NULL = efectivo; un método bancario sin cuenta se rechaza (ver cashFlow.ts).
  const accountId = resolvePaymentAccount(method, body?.accountId)

  const db = useDb()

  // Transacción con el movimiento bloqueado ANTES de leer el saldo: sin el
  // candado, dos abonos simultáneos leen el mismo "ya pagado" y la entrada
  // termina sobrepagada. Mismo patrón que el resto de los "leer estado → actuar".
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${stockMovements} WHERE id = ${movementId} FOR UPDATE`
    )

    const movement = await tx.query.stockMovements.findFirst({
      where: eq(stockMovements.id, movementId),
      columns: {
        id: true,
        storeId: true,
        type: true,
        totalValue: true,
        inventoryEntryInvoiceNumber: true
      },
      with: { payments: { columns: { amount: true } } }
    })
    if (!movement || movement.type !== 'entrada') {
      throw createError({ statusCode: 404, statusMessage: 'Entrada no existe' })
    }

    if (isStoreScopedRole(profile.role) && movement.storeId !== profile.storeId) {
      throw createError({
        statusCode: 403,
        statusMessage: 'No puedes pagar entradas de otra sucursal'
      })
    }

    // Una entrada anulada no se paga: la anulación borra los abonos existentes,
    // así que aceptar uno nuevo dejaría dinero colgado de mercancía devuelta.
    const reversal = await tx.query.stockMovements.findFirst({
      where: and(
        eq(stockMovements.type, 'anulacion'),
        eq(stockMovements.reversesMovementId, movementId)
      ),
      columns: { id: true }
    })
    if (reversal) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Esta entrada está anulada; no admite pagos'
      })
    }

    const totalToPay = Number(movement.totalValue)
    const alreadyPaid = movement.payments.reduce((sum, p) => sum + Number(p.amount), 0)
    const remaining = Math.round((totalToPay - alreadyPaid) * 100) / 100

    if (remaining <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Esta entrada ya está pagada por completo'
      })
    }
    // Tolerancia de un centavo por redondeo en el cliente.
    if (amount > remaining + 0.01) {
      throw createError({
        statusCode: 400,
        statusMessage:
          `El abono (${amount.toFixed(2)}) excede el saldo pendiente (${remaining.toFixed(2)}).`
      })
    }

    const [created] = await tx
      .insert(entryPayments)
      .values({
        movementId,
        amount: String(amount),
        paidAt,
        method,
        accountId,
        note: body?.note?.trim() || null,
        createdBy: profile.id
      })
      .returning()
    if (!created) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo registrar el pago' })
    }

    // Aquí sí sale dinero (capturar la entrada no lo movía).
    const cashFlow = await recordPaymentCashFlow(tx, {
      source: { kind: 'entrada', entryPaymentId: created.id },
      amount,
      paidAt,
      accountId,
      method,
      storeId: movement.storeId,
      profileId: profile.id,
      note: `Pago entrada ${movement.inventoryEntryInvoiceNumber ?? movementId}`
    })

    return { ...created, cashFlow }
  })
})
