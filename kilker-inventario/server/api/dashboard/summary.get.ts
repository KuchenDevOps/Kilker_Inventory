// ───────────────────────────────────────────────
//  GET /api/dashboard/summary — todas las métricas del dashboard en 1 request
// ───────────────────────────────────────────────

import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import {
  entryPayments,
  expensePayments,
  expenses,
  invoices,
  stockMovements
} from '../../db/schema'
import { computeMonthlyInventory } from '../../utils/monthlyInventory'
import { computeSoldTotals } from '../../utils/topProducts'

/** `GET /api/movements` recorta from/to a YYYY-MM-DD antes de comparar. */
function toMovementDate(v: unknown): string | null {
  if (v == null || v === '') return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** `GET /api/expenses` toma los primeros 10 caracteres si son una fecha. */
function toExpenseDate(v: unknown): string | null {
  const match = String(v ?? '').match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

const EMPTY_EXPENSE_BUCKET = { subtotal: 0, totalPaid: 0, balance: 0 }

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)
  const db = useDb()

  // ─── Alcance por sucursal: el empleado nunca elige, siempre la suya ───
  const isEmployee = profile.role === 'empleado'
  const requestedStoreId = query.storeId ? Number(query.storeId) || undefined : undefined
  const storeId = isEmployee ? (profile.storeId ?? undefined) : requestedStoreId

  const from = query.from ? String(query.from) : undefined
  const to = query.to ? String(query.to) : undefined

  const month = String(query.month ?? '')
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Parámetro month requerido (formato YYYY-MM)'
    })
  }

  // Empleado sin sucursal asignada: no puede ver nada (mismo criterio que el
  // resto de endpoints, que devuelven vacío en vez de error).
  if (isEmployee && profile.storeId == null) {
    return {
      storeId: null,
      from: from ?? null,
      to: to ?? null,
      entriesValue: 0,
      entriesPaid: 0,
      entriesBalance: 0,
      salesValue: 0,
      expenses: { Fijo: EMPTY_EXPENSE_BUCKET, Operativo: EMPTY_EXPENSE_BUCKET },
      soldTotals: { totalCost: 0, totalRevenue: 0, totalProfit: 0 },
      monthly: await computeMonthlyInventory({ profile, month })
    }
  }

  // ─── Entradas de stock (compras) ───
  const entryFilters = [
    eq(stockMovements.type, 'entrada'),
    // El dashboard excluía las entradas con factura 'II'. NULL sí cuenta.
    sql`coalesce(upper(trim(${stockMovements.supplierInvoiceNumber})), '') <> 'II'`,
   
    sql`not exists (
      select 1 from "stock_movements" rev
      where rev."type" = 'anulacion'
        and rev."reverses_movement_id" = ${stockMovements.id}
    )`
  ]
  if (storeId) entryFilters.push(eq(stockMovements.storeId, storeId))
  const entryFrom = toMovementDate(from)
  const entryTo = toMovementDate(to)
  if (entryFrom) entryFilters.push(gte(stockMovements.supplierInvoiceDate, entryFrom))
  if (entryTo) entryFilters.push(lt(stockMovements.supplierInvoiceDate, entryTo))

  // ─── Ventas emitidas ───
  const saleFilters = [eq(invoices.status, 'emitida')]
  if (storeId) saleFilters.push(eq(invoices.storeId, storeId))
  if (from) saleFilters.push(gte(invoices.issuedAt, new Date(from)))
  if (to) saleFilters.push(lt(invoices.issuedAt, new Date(to)))

  // ─── Gastos ───
  const expenseFilters = []
  if (storeId) expenseFilters.push(eq(expenses.storeId, storeId))
  const expenseFrom = toExpenseDate(from)
  const expenseTo = toExpenseDate(to)
  if (expenseFrom) expenseFilters.push(gte(expenses.paidAt, expenseFrom))
  if (expenseTo) expenseFilters.push(lt(expenses.paidAt, expenseTo))

  // Pagado por gasto, para poder topar/clampear por gasto ANTES de agregar
  // por tipo (si no, un sobrepago compensaría el saldo de otro gasto).
  const paymentsAgg = db
    .select({
      expenseId: expensePayments.expenseId,
      paid: sql<string>`sum(${expensePayments.amount})`.as('paid')
    })
    .from(expensePayments)
    .groupBy(expensePayments.expenseId)
    .as('payments_agg')

  // Abonado por entrada, para poder topar por entrada antes de agregar (mismo
  // criterio que gastos: un sobrepago no debe tapar el saldo de otra).
  const entryPaymentsAgg = db
    .select({
      movementId: entryPayments.movementId,
      paid: sql<string>`sum(${entryPayments.amount})`.as('entry_paid')
    })
    .from(entryPayments)
    .groupBy(entryPayments.movementId)
    .as('entry_payments_agg')

  const [entryRows, entryPaymentRows, saleRows, expenseRows, soldTotals, monthly] = await Promise.all([
    db
      .select({ value: sql<string>`coalesce(sum(${stockMovements.totalValue}), 0)` })
      .from(stockMovements)
      .where(and(...entryFilters)),

    // Pagado y saldo de esas mismas entradas. `least`/`greatest` topan por
    // entrada para que pagado + pendiente nunca exceda su costo.
    db
      .select({
        totalPaid: sql<string>`coalesce(sum(least(round(${stockMovements.totalValue}, 2), round(coalesce(${entryPaymentsAgg.paid}, 0), 2))), 0)`,
        balance: sql<string>`coalesce(sum(greatest(0, round(${stockMovements.totalValue}, 2) - round(coalesce(${entryPaymentsAgg.paid}, 0), 2))), 0)`
      })
      .from(stockMovements)
      .leftJoin(entryPaymentsAgg, eq(entryPaymentsAgg.movementId, stockMovements.id))
      .where(and(...entryFilters)),

    db
      .select({ value: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)` })
      .from(invoices)
      .where(and(...saleFilters)),


    db
      .select({
        type: expenses.type,
        subtotal: sql<string>`coalesce(sum(round(${expenses.amount}, 2)), 0)`,
        totalPaid: sql<string>`coalesce(sum(least(round(${expenses.amount}, 2), round(coalesce(${paymentsAgg.paid}, 0), 2))), 0)`,
        balance: sql<string>`coalesce(sum(greatest(0, round(${expenses.amount}, 2) - round(coalesce(${paymentsAgg.paid}, 0), 2))), 0)`
      })
      .from(expenses)
      .leftJoin(paymentsAgg, eq(paymentsAgg.expenseId, expenses.id))
      .where(expenseFilters.length ? and(...expenseFilters) : undefined)
      .groupBy(expenses.type),

    computeSoldTotals({ profile, storeId, from, to }),

    computeMonthlyInventory({ profile, month, storeId })
  ])

  const round2 = (n: number) => Math.round(n * 100) / 100

  const expensesByType: Record<'Fijo' | 'Operativo', typeof EMPTY_EXPENSE_BUCKET> = {
    Fijo: { ...EMPTY_EXPENSE_BUCKET },
    Operativo: { ...EMPTY_EXPENSE_BUCKET }
  }
  for (const row of expenseRows) {
    expensesByType[row.type] = {
      subtotal: round2(Number(row.subtotal)),
      totalPaid: round2(Number(row.totalPaid)),
      balance: round2(Number(row.balance))
    }
  }

  return {
    storeId: storeId ?? null,
    from: from ?? null,
    to: to ?? null,
    entriesValue: round2(Number(entryRows[0]?.value ?? 0)),
    entriesPaid: round2(Number(entryPaymentRows[0]?.totalPaid ?? 0)),
    entriesBalance: round2(Number(entryPaymentRows[0]?.balance ?? 0)),
    salesValue: round2(Number(saleRows[0]?.value ?? 0)),
    expenses: expensesByType,
    soldTotals,
    monthly
  }
})
