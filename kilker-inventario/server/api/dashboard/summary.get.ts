// ───────────────────────────────────────────────
//  GET /api/dashboard/summary — todas las métricas del dashboard en 1 request
// ───────────────────────────────────────────────
// Antes el dashboard se descargaba ventas, entradas y gastos COMPLETOS del
// periodo para sumarlos en JavaScript: 7 peticiones autenticadas y megabytes
// de payload. Aquí se agrega en SQL y se devuelve solo el resultado.
//
// Reglas replicadas tal cual de los endpoints originales, para que los
// números no cambien:
//   · Entradas  → stock_movements type='entrada', filtrado por
//                 supplier_invoice_date (igual que GET /api/movements), y
//                 excluyendo las facturas 'II' (lo hacía el dashboard).
//   · Ventas    → invoices status='emitida', filtrado por issued_at.
//   · Gastos    → expenses filtrado por paid_at; subtotal = suma de líneas,
//                 pagado = suma de abonos, saldo = max(0, amount − pagado)
//                 calculado POR gasto antes de sumar (igual que la UI).
//
// Parámetros: ?storeId (admin; el empleado siempre ve la suya), ?from, ?to
// (ISO) y ?month (YYYY-MM) para el cierre de inventario.
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import {
  expenseItems,
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
    sql`coalesce(upper(trim(${stockMovements.supplierInvoiceNumber})), '') <> 'II'`
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

  // Subtotal (suma de líneas) y pagado (suma de abonos) por gasto, para poder
  // aplicar el max(0, …) del saldo ANTES de agregar por tipo.
  const itemsAgg = db
    .select({
      expenseId: expenseItems.expenseId,
      subtotal: sql<string>`sum(${expenseItems.amount})`.as('subtotal')
    })
    .from(expenseItems)
    .groupBy(expenseItems.expenseId)
    .as('items_agg')

  const paymentsAgg = db
    .select({
      expenseId: expensePayments.expenseId,
      paid: sql<string>`sum(${expensePayments.amount})`.as('paid')
    })
    .from(expensePayments)
    .groupBy(expensePayments.expenseId)
    .as('payments_agg')

  const [entryRows, saleRows, expenseRows, soldTotals, monthly] = await Promise.all([
    db
      .select({ value: sql<string>`coalesce(sum(${stockMovements.totalValue}), 0)` })
      .from(stockMovements)
      .where(and(...entryFilters)),

    db
      .select({ value: sql<string>`coalesce(sum(${invoices.totalAmount}), 0)` })
      .from(invoices)
      .where(and(...saleFilters)),

    db
      .select({
        type: expenses.type,
        subtotal: sql<string>`coalesce(sum(round(coalesce(${itemsAgg.subtotal}, 0), 2)), 0)`,
        totalPaid: sql<string>`coalesce(sum(round(coalesce(${paymentsAgg.paid}, 0), 2)), 0)`,
        balance: sql<string>`coalesce(sum(greatest(0, round(${expenses.amount}, 2) - round(coalesce(${paymentsAgg.paid}, 0), 2))), 0)`
      })
      .from(expenses)
      .leftJoin(itemsAgg, eq(itemsAgg.expenseId, expenses.id))
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
    salesValue: round2(Number(saleRows[0]?.value ?? 0)),
    expenses: expensesByType,
    soldTotals,
    monthly
  }
})
