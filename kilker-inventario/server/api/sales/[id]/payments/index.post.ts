// ───────────────────────────────────────────────
//  POST /api/sales/:id/payments — registrar un abono de una venta
// ───────────────────────────────────────────────
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { invoices, paymentMethod, salePayments } from '../../../../db/schema'
import { recordPaymentCashFlow, resolvePaymentAccount } from '../../../../utils/cashFlow'

interface NewPaymentBody {
  amount?: number | string
  paidAt?: string
  method?: string
  /** Cuenta bancaria del cobro. Obligatoria salvo en efectivo. */
  accountId?: number | string | null
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
  // NULL = efectivo. Un método bancario sin cuenta se rechaza aquí: en la base
  // "sin cuenta" y "efectivo" son el mismo estado, así que dejarlo pasar movería
  // el saldo de la bolsa de efectivo en vez del de la cuenta.
  const accountId = resolvePaymentAccount(method, body?.accountId)

  const db = useDb()

  // ⚠️ Todo en una transacción, y con la factura bloqueada ANTES de leer el
  // saldo. Antes esto eran dos lecturas y un insert sueltos: en READ COMMITTED
  // dos abonos simultáneos —un doble clic basta— leían el mismo "ya pagado",
  // los dos pasaban el tope y la venta terminaba sobrecobrada. Es el mismo
  // patrón "leer estado → actuar" que ya blindan las ventas y los cortes.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${invoices} WHERE id = ${invoiceId} FOR UPDATE`)

    const invoice = await tx.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
      columns: {
        id: true,
        folio: true,
        storeId: true,
        status: true,
        totalAmount: true,
        totalToPay: true
      },
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

    // ⚠️ El cobrable es `invoices.total_to_pay` = subtotal (ya con descuento) +
    // IVA, una columna GENERADA por Postgres. Se LEE, no se recalcula: cobrar
    // `total_amount * 1.16` aquí sería una segunda definición del importe, y esa
    // es exactamente la divergencia que en gastos dejó entrar pagos inflados.
    const totalToPay = Number(invoice.totalToPay)

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

    const [created] = await tx
      .insert(salePayments)
      .values({
        invoiceId,
        amount: String(amount),
        paidAt,
        method,
        accountId,
        note: body?.note?.trim() || null,
        createdBy: profile.id
      })
      .returning()
    if (!created) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo registrar el cobro' })
    }

    // Aquí sí entra dinero (emitir la venta no lo movía). Mismo `tx`: si el
    // asiento falla, el cobro no queda registrado.
    const cashFlow = await recordPaymentCashFlow(tx, {
      source: { kind: 'venta', salePaymentId: created.id },
      amount,
      paidAt,
      accountId,
      method,
      storeId: invoice.storeId,
      profileId: profile.id,
      note: `Cobro venta ${invoice.folio}`
    })

    return { ...created, cashFlow }
  })
})
