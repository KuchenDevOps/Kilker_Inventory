// ───────────────────────────────────────────────
//  FLUJO DE DINERO (transaccional)
// ───────────────────────────────────────────────
// Asienta en `banks_movements` el dinero que mueve cada PAGO. Compartido por
// los tres endpoints de abonos (ventas, entradas, gastos) y por las dos
// anulaciones de corrections.ts, igual que `voidInvoiceTx`/`voidMovementTx`
// están compartidos entre el void directo del admin y la resolución del ticket.
//
// ⚠️ LO QUE MUEVE DINERO ES EL PAGO, NO EL DOCUMENTO. Una venta emitida a
// crédito no mueve un peso hasta que se cobra; una entrada facturada, hasta que
// se paga. Por eso no hay nada colgado de `invoices` ni de `stock_movements`:
// este saldo NO cuadra contra "ventas del periodo", y no debe — la diferencia
// es la cartera por cobrar y por pagar.
//
// ⚠️ TODO ESTO CORRE DENTRO DE LA TRANSACCIÓN DEL PAGO, recibiendo el `tx` como
// primer argumento. Si el abono se cae (excede el saldo, la venta está
// anulada), el movimiento de dinero se cae con él; y si el asiento falla, el
// abono se revierte. Un saldo que "a veces" se actualiza es peor que uno que no
// existe, porque nadie sabe cuándo desconfiar de él.
//
// Se descartó hacerlo con un TRIGGER de Postgres sobre las tablas de pagos:
// funcionaría, pero la regla quedaría invisible desde `server/api/` —que es
// donde este proyecto pone las reglas—, los seeds la dispararían sin querer, y
// el backfill del histórico tendría que desactivarlo a mano.
import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { banksMovements } from '../db/schema'
import { businessDateOnly } from './businessTime'
import type { BanksMovement } from '../db/schema'

/** Transacción Drizzle (el `tx` que entrega `db.transaction(...)`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

type PaymentMethod = NonNullable<BanksMovement['method']>

/** De qué abono viene el movimiento. Exactamente uno. */
export type CashFlowSource =
  | { kind: 'venta'; salePaymentId: number }
  | { kind: 'entrada'; entryPaymentId: number }
  | { kind: 'gasto'; expensePaymentId: number }

/** Concepto y signo que le toca a cada origen. */
const SOURCE_RULES = {
  venta: { type: 'cobro_venta', sign: 1 },
  entrada: { type: 'pago_entrada', sign: -1 },
  gasto: { type: 'pago_gasto', sign: -1 }
} as const

/**
 * Asienta el movimiento de dinero de un abono ya insertado.
 *
 * `amount` va SIEMPRE positivo: el signo lo pone el origen, no quien llama. Es
 * a propósito — los tres endpoints validan `amount > 0` antes de guardar el
 * abono, así que dejarles decidir el signo sólo abre la puerta a que uno lo
 * mande al revés y el saldo se mueva para el lado contrario en silencio.
 *
 * `accountId` en NULL significa EFECTIVO, que es su propia bolsa (el efectivo
 * no está en `bank_accounts`). Los endpoints ya exigen cuenta cuando el método
 * no es efectivo, así que aquí un NULL siempre es un pago en efectivo de
 * verdad, no una captura incompleta.
 */
export async function recordPaymentCashFlow(
  tx: Tx,
  opts: {
    source: CashFlowSource
    /** Importe del abono, positivo. */
    amount: number
    /** El `paid_at` del abono (`YYYY-MM-DD`). */
    paidAt: string
    accountId: number | null
    method: PaymentMethod
    storeId: number | null
    profileId: string
    /** Folio del documento, para que el rastro sobreviva al borrado del abono. */
    note?: string | null
  }
): Promise<BanksMovement> {
  const amount = Number(opts.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Importe inválido al asentar el flujo de dinero'
    })
  }

  const rule = SOURCE_RULES[opts.source.kind]

  const [row] = await tx
    .insert(banksMovements)
    .values({
      type: rule.type,
      amount: String(rule.sign * amount),
      occurredAt: opts.paidAt,
      accountId: opts.accountId,
      storeId: opts.storeId,
      salePaymentId: 'salePaymentId' in opts.source ? opts.source.salePaymentId : null,
      entryPaymentId: 'entryPaymentId' in opts.source ? opts.source.entryPaymentId : null,
      expensePaymentId:
        'expensePaymentId' in opts.source ? opts.source.expensePaymentId : null,
      method: opts.method,
      note: opts.note ?? null,
      createdBy: opts.profileId
    })
    .returning()

  if (!row) {
    throw createError({
      statusCode: 500,
      statusMessage: 'No se pudo asentar el movimiento de dinero'
    })
  }
  return row
}

/**
 * Reversa APPEND-ONLY del movimiento de dinero de un abono.
 *
 * No borra ni edita la fila original: agrega una `anulacion` con el importe
 * invertido y `reverses_id` apuntando a ella — mismo patrón que la `anulacion`
 * del kardex. El saldo de la cuenta vuelve a su valor previo y queda el rastro
 * de por qué.
 *
 * ⚠️ Hay que llamarla ANTES de borrar el abono. `banks_movements.sale_payment_id`
 * es `ON DELETE SET NULL`, así que borrar primero deja la fila huérfana y ya no
 * hay por dónde encontrarla.
 *
 * Tolera que no haya nada que revertir (`null`), y debe: los abonos anteriores
 * a esta tabla no asentaron dinero, y anular una venta que los tenga no es un
 * error.
 */
export async function reversePaymentCashFlowTx(
  tx: Tx,
  opts: {
    source:
      | { salePaymentIds: number[] }
      | { entryPaymentIds: number[] }
      | { expensePaymentIds: number[] }
    profileId: string
    reason: string | null
  }
): Promise<BanksMovement[]> {
  // Una sola forma de resolver "qué columna liga el abono con su movimiento":
  // con un if por cada origen, agregar el cuarto significaba acordarse de
  // tocar los dos sitios (la lista de ids y el `where`), y olvidar el segundo
  // no falla — simplemente no revierte nada.
  const column = 'salePaymentIds' in opts.source
    ? banksMovements.salePaymentId
    : 'entryPaymentIds' in opts.source
      ? banksMovements.entryPaymentId
      : banksMovements.expensePaymentId

  const ids =
    'salePaymentIds' in opts.source
      ? opts.source.salePaymentIds
      : 'entryPaymentIds' in opts.source
        ? opts.source.entryPaymentIds
        : opts.source.expensePaymentIds
  if (ids.length === 0) return []

  const reversals: BanksMovement[] = []
  const today = businessDateOnly(new Date())

  for (const id of ids) {
    const original = await tx.query.banksMovements.findFirst({ where: eq(column, id) })
    if (!original) continue

    // Candado de fila antes de decidir, igual que en corrections.ts: sin él dos
    // anulaciones simultáneas leen ambas "no revertido" y una se estrella
    // contra `banks_movements_reverses_uniq` en vez de esperar su turno.
    await tx.execute(
      sql`SELECT id FROM ${banksMovements} WHERE id = ${original.id} FOR UPDATE`
    )

    const already = await tx.query.banksMovements.findFirst({
      where: eq(banksMovements.reversesId, original.id)
    })
    if (already) {
      reversals.push(already)
      continue
    }

    const [row] = await tx
      .insert(banksMovements)
      .values({
        type: 'anulacion',
        amount: String(-Number(original.amount)),
        // La reversa ocurre HOY, no en la fecha del abono anulado: el dinero se
        // devuelve ahora. Fecharla en el original cambiaría saldos de periodos
        // ya cerrados y cortados.
        occurredAt: today,
        accountId: original.accountId,
        storeId: original.storeId,
        reversesId: original.id,
        method: original.method,
        note: opts.reason,
        createdBy: opts.profileId
      })
      .returning()

    if (row) reversals.push(row)
  }

  return reversals
}

/**
 * Valida la pareja método ↔ cuenta que capturó el usuario.
 *
 * ⚠️ Existe porque en la base "sin cuenta" y "efectivo" son el mismo estado
 * (`account_id IS NULL`). Sin esta validación, una transferencia capturada sin
 * elegir cuenta caería en la bolsa de efectivo sin avisar, y ese peso saldría
 * mal contado en dos saldos a la vez.
 *
 * No es un check de la BD a propósito: los pagos que ya existen son anteriores
 * al catálogo de cuentas y todos tienen `account_id` en NULL con métodos
 * bancarios. Un CHECK los rechazaría y la migración no correría.
 */
export function resolvePaymentAccount(
  method: PaymentMethod,
  accountId: unknown
): number | null {
  if (method === 'efectivo') {
    if (accountId != null) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Un pago en efectivo no lleva cuenta bancaria'
      })
    }
    return null
  }

  const id = Number(accountId)
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: `Elige la cuenta bancaria del pago por ${method}`
    })
  }
  return id
}
