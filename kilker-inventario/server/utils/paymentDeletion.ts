// ───────────────────────────────────────────────
//  BORRADO DE UN PAGO SUELTO (transaccional)
// ───────────────────────────────────────────────
// Compartido por los tres endpoints `DELETE /api/{sales,movements,expenses}/:id/payments/:paymentId`,
// igual que `voidInvoiceTx`/`voidMovementTx`/`voidExpenseTx` lo están para las
// anulaciones. Una sola implementación: el orden "revertir el dinero → borrar el
// abono" es exactamente el que ya se equivocó una vez en gastos, y con tres
// copias la siguiente sólo se arreglaría en dos.
//
// ⚠️ Existe porque anular el documento entero es demasiado para una errata de
// captura: un pago tecleado con el monto, la fecha o la cuenta equivocada
// obligaba a anular la venta (reponiendo inventario), la entrada (sacándolo) o
// el gasto, y eso BORRA todos los demás abonos. Aquí se quita uno y el
// documento sigue vivo.
//
// ⚠️ Solo admin (el candado está en los endpoints). No es captura: es deshacer
// dinero ya asentado, misma categoría que anular una venta.
//
// ⚠️ El movimiento de banco NO se borra: se revierte con una `anulacion`
// (append-only, igual que el kardex), así que el saldo de la cuenta vuelve a su
// valor previo y queda el rastro del par. Ver `reversePaymentCashFlowTx`.
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import {
  entryPayments,
  expensePayments,
  expenses,
  invoices,
  salePayments,
  stockMovements
} from '../db/schema'
import { reversePaymentCashFlowTx } from './cashFlow'
import type { PaymentKind } from './bankAccounts'

/** Transacción Drizzle (el `tx` que entrega `db.transaction(...)`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const DOC_NOUN: Record<PaymentKind, string> = {
  sale: 'venta',
  entry: 'entrada',
  expense: 'gasto'
}

/**
 * Borra UN abono de un documento y revierte el dinero que movió.
 *
 * Devuelve el importe borrado y cuántas reversas de banco se asentaron
 * (`cashFlowReversals`). Puede ser 0 y no es un error: los abonos anteriores a
 * `banks_movements` nunca asentaron dinero, así que no hay nada que devolver —
 * pero la UI necesita saberlo para no prometer un saldo que no se movió.
 */
export async function deleteDocumentPaymentTx(
  tx: Tx,
  opts: {
    kind: PaymentKind
    documentId: number
    paymentId: number
    profileId: string
    reason: string | null
  }
) {
  const { kind, documentId, paymentId, profileId } = opts
  const noun = DOC_NOUN[kind]

  // ⚠️ Candado del DOCUMENTO, no del abono, y antes de leer nada. Es el mismo
  // que toma `POST .../payments` para decidir el saldo pendiente: sin él, un
  // cobro simultáneo lee "ya pagado" incluyendo el abono que esta transacción
  // está borrando, y la venta termina cobrada de menos sin que nada falle. De
  // paso serializa dos borrados del mismo pago (doble clic): el segundo espera
  // y ya no lo encuentra.
  if (kind === 'sale') {
    await tx.execute(sql`SELECT id FROM ${invoices} WHERE id = ${documentId} FOR UPDATE`)
  } else if (kind === 'entry') {
    await tx.execute(
      sql`SELECT id FROM ${stockMovements} WHERE id = ${documentId} FOR UPDATE`
    )
  } else {
    await tx.execute(sql`SELECT id FROM ${expenses} WHERE id = ${documentId} FOR UPDATE`)
  }

  // El abono se busca ligado a SU documento, no sólo por id: sin el `and`, un
  // `paymentId` de otra factura se borraría desde la ruta de ésta.
  const payment =
    kind === 'sale'
      ? await tx.query.salePayments.findFirst({
          where: and(eq(salePayments.id, paymentId), eq(salePayments.invoiceId, documentId)),
          columns: { id: true, amount: true }
        })
      : kind === 'entry'
        ? await tx.query.entryPayments.findFirst({
            where: and(
              eq(entryPayments.id, paymentId),
              eq(entryPayments.movementId, documentId)
            ),
            columns: { id: true, amount: true }
          })
        : await tx.query.expensePayments.findFirst({
            where: and(
              eq(expensePayments.id, paymentId),
              eq(expensePayments.expenseId, documentId)
            ),
            columns: { id: true, amount: true }
          })

  if (!payment) {
    throw createError({
      statusCode: 404,
      statusMessage: `El pago no existe en esta ${noun}`
    })
  }

  // ⚠️ ORDEN: revertir el flujo ANTES de borrar el abono, igual que en las tres
  // anulaciones. `banks_movements.*_payment_id` es `ON DELETE SET NULL`: si se
  // borra primero, el movimiento de dinero queda huérfano y ya no hay por dónde
  // encontrarlo — ese peso se quedaría sumado (o restado) a la cuenta para
  // siempre.
  const label = `Borrado de un pago de la ${noun} #${documentId}`
  const cashFlowReversals = await reversePaymentCashFlowTx(tx, {
    source:
      kind === 'sale'
        ? { salePaymentIds: [paymentId] }
        : kind === 'entry'
          ? { entryPaymentIds: [paymentId] }
          : { expensePaymentIds: [paymentId] },
    profileId,
    reason: opts.reason ? `${label}: ${opts.reason}` : label
  })

  if (kind === 'sale') {
    await tx.delete(salePayments).where(eq(salePayments.id, paymentId))
  } else if (kind === 'entry') {
    await tx.delete(entryPayments).where(eq(entryPayments.id, paymentId))
  } else {
    await tx.delete(expensePayments).where(eq(expensePayments.id, paymentId))
  }

  return {
    ok: true as const,
    paymentId,
    amount: payment.amount,
    cashFlowReversals: cashFlowReversals.length
  }
}
