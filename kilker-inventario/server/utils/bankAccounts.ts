// ───────────────────────────────────────────────
//  USO DE LAS CUENTAS BANCARIAS
// ───────────────────────────────────────────────
// "¿Cuántos pagos cuelgan de esta cuenta?" lo preguntan el listado
// (`GET /api/bank-accounts`, para la columna "Pagos") y el PATCH (para decidir
// si los últimos 4 siguen siendo editables). Vive aquí para que las dos
// respuestas no puedan divergir.
//
// ⚠️ Los pagos están repartidos en TRES tablas —ventas, entradas y gastos— y no
// hay ninguna vista que las una. Si algún día se agrega un cuarto tipo de pago,
// las dos funciones de este archivo son el único lugar que hay que tocar; no
// dejes que el conteo se vuelva a escribir a mano en un endpoint.
import { eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { bankAccounts, banksMovements, entryPayments, expensePayments, salePayments } from '../db/schema'
import type { Db } from '../db'

/**
 * Pagos por cuenta, para todas las cuentas de golpe.
 *
 * Los pagos en EFECTIVO (`account_id` null) se excluyen: no pertenecen a ninguna
 * cuenta, son su propia bolsa (ver `bank_accounts` en schema.ts).
 */
export async function countPaymentsByAccount(db: Db): Promise<Map<number, number>> {
  const [sales, entries, expenses] = await Promise.all([
    db
      .select({ accountId: salePayments.accountId, count: sql<number>`count(*)::int` })
      .from(salePayments)
      .where(isNotNull(salePayments.accountId))
      .groupBy(salePayments.accountId),
    db
      .select({ accountId: entryPayments.accountId, count: sql<number>`count(*)::int` })
      .from(entryPayments)
      .where(isNotNull(entryPayments.accountId))
      .groupBy(entryPayments.accountId),
    db
      .select({ accountId: expensePayments.accountId, count: sql<number>`count(*)::int` })
      .from(expensePayments)
      .where(isNotNull(expensePayments.accountId))
      .groupBy(expensePayments.accountId)
  ])

  const byAccount = new Map<number, number>()
  for (const row of [...sales, ...entries, ...expenses]) {
    if (row.accountId == null) continue
    byAccount.set(row.accountId, (byAccount.get(row.accountId) ?? 0) + row.count)
  }
  return byAccount
}

/** Pagos de UNA cuenta. Mismas tres tablas que `countPaymentsByAccount`. */
export async function countPaymentsForAccount(db: Db, accountId: number): Promise<number> {
  const [sales, entries, expenses] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salePayments)
      .where(eq(salePayments.accountId, accountId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(entryPayments)
      .where(eq(entryPayments.accountId, accountId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(expensePayments)
      .where(eq(expensePayments.accountId, accountId))
  ])

  return (sales[0]?.count ?? 0) + (entries[0]?.count ?? 0) + (expenses[0]?.count ?? 0)
}

// ───────────────────────────────────────────────
//  ASIGNACIÓN MASIVA DE CUENTA (corrección)
// ───────────────────────────────────────────────

/** Qué documento agrupa los pagos. */
export type PaymentKind = 'sale' | 'entry' | 'expense'

/**
 * Pone la misma cuenta en TODOS los pagos bancarios de un documento.
 *
 * Existe para dos cosas: rellenar los pagos históricos —los que se capturaron
 * antes de que existiera el catálogo de cuentas— y corregir una cuenta mal
 * elegida sin tener que borrar y recapturar el abono.
 *
 * ⚠️ Los pagos en EFECTIVO se saltan siempre, pase lo que pase. En la base
 * `account_id IS NULL` es lo que SIGNIFICA efectivo, así que ponerle cuenta a
 * uno no lo reclasifica: lo convierte en un pago bancario que nunca existió, y
 * ese dinero pasa a contarse en el saldo de una cuenta real. Por eso se filtran
 * aquí y no en la UI: la UI se salta con un PATCH directo.
 *
 * ⚠️ Toca también `banks_movements`. Parece violar el append-only, y no lo
 * viola: no se cambia importe, fecha, tipo ni signo — nada de lo que el libro
 * protege. Se corrige a QUÉ cuenta se atribuyó un movimiento que ya existía.
 * Dejarlos desincronizados sería peor: el pago diría "BBVA" y el flujo seguiría
 * sumando ese dinero al efectivo, y nada delataría la discrepancia.
 */
export async function assignAccountToDocumentPayments(
  db: Db,
  opts: { kind: PaymentKind; documentId: number; accountId: number | null }
): Promise<{ updated: number; skippedCash: number }> {
  const { kind, documentId, accountId } = opts

  // La cuenta tiene que existir y estar activa: asignar una cuenta dada de baja
  // volvería a meter dinero a un saldo que se cerró a propósito.
  if (accountId != null) {
    const account = await db.query.bankAccounts.findFirst({
      where: eq(bankAccounts.id, accountId)
    })
    if (!account) {
      throw createError({ statusCode: 404, statusMessage: 'La cuenta bancaria no existe' })
    }
    if (!account.isActive) {
      throw createError({
        statusCode: 400,
        statusMessage: `La cuenta ${account.bank} · ${account.owner} está desactivada`
      })
    }
  }

  return await db.transaction(async (tx) => {
    let rows: { id: number; method: string }[]
    if (kind === 'sale') {
      rows = await tx
        .select({ id: salePayments.id, method: salePayments.method })
        .from(salePayments)
        .where(eq(salePayments.invoiceId, documentId))
    } else if (kind === 'entry') {
      rows = await tx
        .select({ id: entryPayments.id, method: entryPayments.method })
        .from(entryPayments)
        .where(eq(entryPayments.movementId, documentId))
    } else {
      rows = await tx
        .select({ id: expensePayments.id, method: expensePayments.method })
        .from(expensePayments)
        .where(eq(expensePayments.expenseId, documentId))
    }

    const bankRows = rows.filter((r) => r.method !== 'efectivo')
    const skippedCash = rows.length - bankRows.length
    const ids = bankRows.map((r) => r.id)
    if (ids.length === 0) return { updated: 0, skippedCash }

    if (kind === 'sale') {
      await tx.update(salePayments).set({ accountId }).where(inArray(salePayments.id, ids))
      await tx
        .update(banksMovements)
        .set({ accountId })
        .where(inArray(banksMovements.salePaymentId, ids))
    } else if (kind === 'entry') {
      await tx.update(entryPayments).set({ accountId }).where(inArray(entryPayments.id, ids))
      await tx
        .update(banksMovements)
        .set({ accountId })
        .where(inArray(banksMovements.entryPaymentId, ids))
    } else {
      await tx.update(expensePayments).set({ accountId }).where(inArray(expensePayments.id, ids))
      await tx
        .update(banksMovements)
        .set({ accountId })
        .where(inArray(banksMovements.expensePaymentId, ids))
    }

    return { updated: ids.length, skippedCash }
  })
}
