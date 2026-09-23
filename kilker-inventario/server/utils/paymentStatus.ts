// ───────────────────────────────────────────────
//  Filtro por estado de pago (?paymentStatus) — ventas, entradas y gastos
// ───────────────────────────────────────────────
// El estado de pago NO vive en la BD: cada endpoint lo deriva en TS al mapear
// (`totalPaid` contra `totalToPay`). Para filtrar por él sobre un listado
// PAGINADO no sirve filtrar el arreglo mapeado —daría páginas cortas y un
// `total` que no cuadra—, así que la misma regla se expresa aquí en SQL y va
// al `where`, igual para la página, el `count()` y los `totals`.
//
// ⚠️ Si cambia la regla del estado en un endpoint (el `let paymentStatus` de
// su `map`), hay que cambiarla aquí también: son la misma definición escrita
// dos veces, una para pintar y otra para filtrar.
//
// ⚠️ Las referencias a la tabla EXTERNA van como columnas de Drizzle
// (`${invoices.id}`), nunca como texto: `db.query` re-aliasea la tabla raíz y
// mapea las columnas del `where` a ese alias, pero el texto crudo no. La tabla
// interna sí va como texto, con su propio alias, justo para que no la mapee.
import { sql, type SQL } from 'drizzle-orm'

export const PAYMENT_STATUS_FILTERS = ['pendiente', 'parcial', 'pagado'] as const
export type PaymentStatusFilter = (typeof PAYMENT_STATUS_FILTERS)[number]

export function parsePaymentStatusFilter(v: unknown): PaymentStatusFilter | null {
  const s = String(v ?? '').trim()
  return (PAYMENT_STATUS_FILTERS as readonly string[]).includes(s) ? (s as PaymentStatusFilter) : null
}

export interface PaymentStatusSql {
  /** Suma de los abonos del documento (subconsulta correlacionada, nunca NULL). */
  paid: SQL
  /** Lo cobrable/pagable: la columna generada `total_to_pay`. */
  toPay: SQL
  /** Verdadero si el documento está anulado. */
  voided: SQL
  /**
   * Gastos: uno con pagable 0 no cuenta como pagado (`totalToPay > 0`).
   * Ventas y entradas: un pagable 0 nace pagado (muestras, 100% de descuento).
   */
  requirePositiveToPay?: boolean
}

export function paymentStatusCondition(status: PaymentStatusFilter, s: PaymentStatusSql): SQL {
  const paidOff = s.requirePositiveToPay
    ? sql`(${s.paid} >= ${s.toPay} and ${s.toPay} > 0)`
    : sql`(${s.paid} >= ${s.toPay})`

  switch (status) {
    case 'pagado':
      return sql`(not ${s.voided} and ${paidOff})`
    case 'parcial':
      return sql`(not ${s.voided} and not ${paidOff} and ${s.paid} > 0)`
    case 'pendiente':
      return sql`(not ${s.voided} and not ${paidOff} and ${s.paid} <= 0)`
  }
}
