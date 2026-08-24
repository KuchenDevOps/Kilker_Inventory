// ───────────────────────────────────────────────
//  POST /api/sales/:id/payments — registrar un abono de una venta
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { invoices, paymentMethod, salePayments } from '../../../../db/schema'

interface NewPaymentBody {
  amount?: number | string
  paidAt?: string
  method?: string
  note?: string
}

// Del enum de la BD, no una copia a mano: al partir 'tarjeta' en débito/crédito
// las listas hardcodeadas se quedaron viejas y rechazaban en silencio los
// métodos nuevos.
const ALLOWED_METHODS = paymentMethod.enumValues

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const invoiceId = Number(getRouterParam(event, 'id'))
  if (!invoiceId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

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

  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
    columns: { id: true, storeId: true, status: true, totalAmount: true },
    with: { payments: { columns: { amount: true } } }
  })
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Venta no existe' })

  if (isStoreScopedRole(profile.role) && invoice.storeId !== profile.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No puedes pagar ventas de otra sucursal'
    })
  }

  // Una venta anulada no se cobra: la anulación borra los abonos existentes,
  // así que aceptar uno nuevo dejaría dinero colgado de mercancía devuelta.
  if (invoice.status === 'anulada') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Esta venta está anulada; no admite pagos'
    })
  }

  // El total de la venta ya viene con el descuento aplicado y SIN IVA (el 16%
  // de la app es informativo y no se guarda en la BD).
  const totalToPay = Number(invoice.totalAmount)

  // Venta de $0 —una entrega de muestras, o un 100% de descuento—: no hay nada
  // que cobrar, y el listado ya la reporta como pagada.
  if (totalToPay <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Esta venta no tiene importe que cobrar'
    })
  }

  const alreadyPaid = invoice.payments.reduce((sum, p) => sum + Number(p.amount), 0)
  const remaining = Math.round((totalToPay - alreadyPaid) * 100) / 100

  if (remaining <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Esta venta ya está pagada por completo'
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
    .insert(salePayments)
    .values({
      invoiceId,
      amount: String(amount),
      paidAt,
      method,
      note: body?.note?.trim() || null,
      createdBy: profile.id
    })
    .returning()

  return created
})
