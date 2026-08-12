// ───────────────────────────────────────────────
//  POST /api/movements/:id/payments — registrar un abono de una entrada
// ───────────────────────────────────────────────

import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { entryPayments, stockMovements } from '../../../../db/schema'

interface NewPaymentBody {
  amount?: number | string
  paidAt?: string
  method?: string
  note?: string
}

const ALLOWED_METHODS = ['efectivo', 'tarjeta', 'transferencia'] as const

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

  const db = useDb()

  const movement = await db.query.stockMovements.findFirst({
    where: eq(stockMovements.id, movementId),
    columns: { id: true, storeId: true, type: true, totalValue: true },
    with: { payments: { columns: { amount: true } } }
  })
  if (!movement || movement.type !== 'entrada') {
    throw createError({ statusCode: 404, statusMessage: 'Entrada no existe' })
  }

  if (profile.role === 'empleado' && movement.storeId !== profile.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No puedes pagar entradas de otra sucursal'
    })
  }

  // Una entrada anulada no se paga: la anulación borra los abonos existentes,
  // así que aceptar uno nuevo dejaría dinero colgado de mercancía devuelta.
  const reversal = await db.query.stockMovements.findFirst({
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

  const [created] = await db
    .insert(entryPayments)
    .values({
      movementId,
      amount: String(amount),
      paidAt,
      method,
      note: body?.note?.trim() || null,
      createdBy: profile.id
    })
    .returning()

  return created
})
