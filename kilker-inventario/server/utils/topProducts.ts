// ───────────────────────────────────────────────
//  PRODUCTOS MÁS VENDIDOS + COSTO/UTILIDAD FIFO
// ───────────────────────────────────────────────
// Movido desde server/api/reports/top-products.get.ts para poder reusarlo
// desde /api/dashboard/summary sin duplicar el costeo. La lógica es la misma.
//
// Paso 1: top N por cantidad/ingresos (agregado simple sobre invoice_items).
// Paso 2: SOLO para esos productos, reconstruye el FIFO completo (histórico
//         entero, no limitado al periodo — igual que monthly-inventory,
//         porque el costo de lo vendido en el periodo depende de en qué
//         estado quedaron las capas ANTES de que empezara el periodo).
// Paso 3: durante el recorrido cronológico, solo las transacciones que son
//         VENTAS reales (no transferencias/anulaciones/ajustes) dentro de
//         [from, to) aportan al costo. Así el costo es el FIFO real
//         consumido por esas ventas, no un promedio aproximado.
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { useDb } from '../db'
import {
  invoiceItems,
  invoices,
  inventory,
  products,
  stockMovements,
  transfers
} from '../db/schema'
import type { SessionProfile } from './auth'

interface Transaction {
  date: Date
  type: 'entrada' | 'salida'
  quantity: number
  unitValue: number
  totalValue: number
  // Solo las 'salida' que vienen de una venta real cuentan como COGS del
  // periodo. Transferencias, anulaciones de entrada y ajustes negativos
  // también consumen capas (afectan qué queda disponible), pero no son
  // "costo de lo vendido".
  isSale: boolean
}

type ProductUnit = (typeof products.$inferSelect)['unit']

export interface TopProductRow {
  productId: number
  productName: string | null
  productSku: string | null
  unit: ProductUnit | null
  totalQuantity: number
  totalRevenue: number
  totalCost: number
  profit: number
  profitPct: number
  hasSales: boolean
}

// ─── Caché simple en memoria, TTL corto ───
// Nota: esto es por-proceso. Si corres múltiples instancias del server
// (varios workers/replicas), cada una tiene su propio caché — no hay
// invalidación cruzada. Suficiente para un solo proceso; para multi-
// instancia real, cambiar por Redis con la misma cacheKey.
const CACHE_TTL_MS = 60_000
const reportCache = new Map<string, { data: unknown; expiresAt: number }>()

function getCached<T>(key: string): T | undefined {
  const hit = reportCache.get(key)
  if (!hit || hit.expiresAt < Date.now()) {
    if (hit) reportCache.delete(key)
    return undefined
  }
  return hit.data as T
}

function setCached(key: string, data: unknown) {
  reportCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export interface TopProductsParams {
  profile: SessionProfile
  /** Sucursal solicitada (admin). Se ignora para empleados. */
  storeId?: number
  /** ISO date-time; límite inferior inclusivo sobre invoices.issued_at. */
  from?: string
  /** ISO date-time; límite superior exclusivo sobre invoices.issued_at. */
  to?: string
  /** 0 = sin límite (hasta 1000). */
  limit?: number
  /** Rellenar con productos activos sin ventas, valuados a costo de inventario. */
  includeUnsold?: boolean
}

export async function computeTopProducts(
  params: TopProductsParams
): Promise<TopProductRow[]> {
  const { profile, includeUnsold = false } = params
  const db = useDb()

  const filters = [eq(invoices.status, 'emitida')]
  let storeIds: number[] | undefined

  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(eq(invoices.storeId, profile.storeId))
    storeIds = [profile.storeId]
  } else if (params.storeId) {
    filters.push(eq(invoices.storeId, params.storeId))
    storeIds = [params.storeId]
  }

  if (params.from) filters.push(gte(invoices.issuedAt, new Date(params.from)))
  if (params.to) filters.push(lt(invoices.issuedAt, new Date(params.to)))

  const limit = params.limit ?? 5

  // ─── Cache lookup ───
  const cacheKey = [
    'top-products',
    profile.role === 'empleado' ? `emp:${profile.storeId}` : `store:${params.storeId ?? 'all'}`,
    `from:${params.from ?? ''}`,
    `to:${params.to ?? ''}`,
    `limit:${limit}`,
    `unsold:${includeUnsold}`
  ].join('|')

  const cached = getCached<TopProductRow[]>(cacheKey)
  if (cached) return cached

  // ─── Paso 1: top N por cantidad/ingresos (rápido, agregado en SQL) ───
  const rankedRows = await db
    .select({
      productId: products.id,
      productName: products.name,
      productSku: products.sku,
      unit: products.unit,
      totalQuantity: sql<string>`sum(${invoiceItems.quantity})`,
      totalRevenue: sql<string>`sum(${invoiceItems.lineTotal})`
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .innerJoin(products, eq(invoiceItems.productId, products.id))
    .where(and(...filters))
    .groupBy(products.id, products.name, products.sku, products.unit)
    .orderBy(desc(sql`sum(${invoiceItems.quantity})`))
    .limit(limit > 0 ? limit : 1000)

  if (rankedRows.length === 0 && !includeUnsold) {
    setCached(cacheKey, [])
    return []
  }

  const topProductIds = rankedRows.map((r) => r.productId)

  // ─── Paso 2: reconstruir FIFO completo SOLO para esos productos ───
  const periodStart = params.from ? new Date(params.from) : null
  const periodEnd = params.to ? new Date(params.to) : new Date('9999-12-31')

  // productId -> costo FIFO real consumido por ventas dentro del periodo
  const costByProduct = new Map<number, number>()

  if (topProductIds.length > 0) {
    const movementFilters = [inArray(stockMovements.productId, topProductIds)]
    if (storeIds && storeIds.length === 1 && storeIds[0] != null) {
      movementFilters.push(eq(stockMovements.storeId, storeIds[0]))
    }

    const invoiceFiltersAllTime = [
      eq(invoices.status, 'emitida')
      // Nota: usamos filtro de tienda pero NO de fecha aquí — necesitamos el
      // historial completo para construir las capas correctamente.
    ]
    if (storeIds && storeIds.length === 1 && storeIds[0] != null) {
      invoiceFiltersAllTime.push(eq(invoices.storeId, storeIds[0]))
    }

    // ─── Queries en paralelo, ambas con builder plano (sin RQB anidado) ───
    const [movementRows, salesRows] = await Promise.all([
      // Un solo LEFT JOIN plano; el modo relacional generaba un lateral join
      // por fila.
      db
        .select({
          id: stockMovements.id,
          productId: stockMovements.productId,
          storeId: stockMovements.storeId,
          type: stockMovements.type,
          quantity: stockMovements.quantity,
          unitValue: stockMovements.unitValue,
          totalValue: stockMovements.totalValue,
          supplierInvoiceDate: stockMovements.supplierInvoiceDate,
          reversesMovementId: stockMovements.reversesMovementId,
          createdAt: stockMovements.createdAt,
          transferIssuedAt: transfers.issuedAt,
          transferReceivedAt: transfers.receivedAt
        })
        .from(stockMovements)
        .leftJoin(transfers, eq(stockMovements.transferId, transfers.id))
        .where(and(...movementFilters)),

      // Un solo JOIN plano entre invoice_items e invoices, filtrado directo
      // por producto.
      db
        .select({
          productId: invoiceItems.productId,
          storeId: invoices.storeId,
          issuedAt: invoices.issuedAt,
          quantity: invoiceItems.quantity,
          unitPrice: invoiceItems.unitPrice,
          lineTotal: invoiceItems.lineTotal
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
        .where(and(...invoiceFiltersAllTime, inArray(invoiceItems.productId, topProductIds)))
    ])

    const movementTypeById = new Map<number, string>()
    for (const m of movementRows) movementTypeById.set(m.id, m.type)

    type SaleLine = { issuedAt: Date; quantity: number; totalValue: number; unitValue: number }
    const salesByKey = new Map<string, SaleLine[]>()
    for (const row of salesRows) {
      const key = `${row.productId}-${row.storeId}`
      if (!salesByKey.has(key)) salesByKey.set(key, [])
      salesByKey.get(key)!.push({
        issuedAt: row.issuedAt,
        quantity: Number(row.quantity),
        totalValue: Number(row.lineTotal),
        unitValue: Number(row.unitPrice)
      })
    }

    const movementsByKey = new Map<string, typeof movementRows>()
    for (const m of movementRows) {
      const key = `${m.productId}-${m.storeId}`
      if (!movementsByKey.has(key)) movementsByKey.set(key, [])
      movementsByKey.get(key)!.push(m)
    }

    const allKeys = new Set<string>([...movementsByKey.keys(), ...salesByKey.keys()])

    for (const key of allKeys) {
      const productId = Number(key.split('-')[0])
      const productMovements = movementsByKey.get(key) ?? []
      const productSales = salesByKey.get(key) ?? []

      const transactions: Transaction[] = []

      for (const m of productMovements) {
        if (m.type === 'entrada') {
          const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
          if (date < periodEnd) {
            transactions.push({
              date,
              type: 'entrada',
              quantity: Number(m.quantity),
              unitValue: Number(m.unitValue),
              totalValue: Number(m.totalValue),
              isSale: false
            })
          }
        }
        if (m.type === 'transferencia_entrada') {
          const receivedAt = m.transferReceivedAt
          if (receivedAt && receivedAt < periodEnd) {
            transactions.push({
              date: receivedAt,
              type: 'entrada',
              quantity: Number(m.quantity),
              unitValue: Number(m.unitValue),
              totalValue: Number(m.totalValue),
              isSale: false
            })
          }
        }
        if (m.type === 'transferencia_salida') {
          const issuedAt = m.transferIssuedAt
          if (issuedAt && issuedAt < periodEnd) {
            transactions.push({
              date: issuedAt,
              type: 'salida',
              quantity: Math.abs(Number(m.quantity)),
              unitValue: Number(m.unitValue),
              totalValue: Math.abs(Number(m.totalValue)),
              isSale: false
            })
          }
        }
        if (m.type === 'anulacion' && m.createdAt < periodEnd) {
          const originalType = m.reversesMovementId
            ? movementTypeById.get(m.reversesMovementId)
            : undefined
          if (originalType === 'entrada') {
            transactions.push({
              date: m.createdAt,
              type: 'salida',
              quantity: Math.abs(Number(m.quantity)),
              unitValue: Number(m.unitValue),
              totalValue: Math.abs(Number(m.totalValue)),
              isSale: false
            })
          }
        }
        if (m.type === 'ajuste') {
          const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
          if (date < periodEnd) {
            const qty = Number(m.quantity)
            if (qty > 0) {
              transactions.push({
                date,
                type: 'entrada',
                quantity: qty,
                unitValue: Number(m.unitValue),
                totalValue: Number(m.totalValue),
                isSale: false
              })
            } else if (qty < 0) {
              transactions.push({
                date,
                type: 'salida',
                quantity: Math.abs(qty),
                unitValue: Number(m.unitValue),
                totalValue: Math.abs(Number(m.totalValue)),
                isSale: false
              })
            }
          }
        }
      }

      for (const s of productSales) {
        if (s.issuedAt < periodEnd) {
          transactions.push({
            date: s.issuedAt,
            type: 'salida',
            quantity: s.quantity,
            unitValue: s.unitValue,
            totalValue: s.totalValue,
            isSale: true
          })
        }
      }

      transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

      const inventoryLayers: Array<{ qty: number; unitCost: number }> = []
      let periodCost = 0

      for (const txn of transactions) {
        if (txn.type === 'entrada') {
          inventoryLayers.push({ qty: txn.quantity, unitCost: txn.unitValue })
          continue
        }

        // Solo importa para el costo del periodo si es venta real Y cae dentro
        // de [periodStart, periodEnd). Aun así, SIEMPRE hay que consumir las
        // capas (ventas fuera de rango también "gastan" inventario, y eso
        // afecta qué capas quedan disponibles para las ventas del periodo).
        const inPeriod = txn.isSale && (!periodStart || txn.date >= periodStart)

        let qtyToConsume = txn.quantity
        let index = 0
        while (qtyToConsume > 0 && index < inventoryLayers.length) {
          const layer = inventoryLayers[index]
          if (!layer) break
          const consumeQty = Math.min(layer.qty, qtyToConsume)
          if (inPeriod) periodCost += consumeQty * layer.unitCost
          layer.qty -= consumeQty
          qtyToConsume -= consumeQty
          if (layer.qty === 0) index++
        }
        inventoryLayers.splice(0, index)

        if (qtyToConsume > 0 && inPeriod) {
          // Faltante de capas: no hay costo histórico que respalde esta venta
          // (dato inconsistente, mismo caso que "stock fantasma"). Se usa el
          // unitValue de la propia venta como aproximación de emergencia para
          // no dejar el costo en 0 artificialmente.
          periodCost += qtyToConsume * txn.unitValue
        }
      }

      costByProduct.set(productId, (costByProduct.get(productId) ?? 0) + periodCost)
    }
  }

  // ─── Paso 3: combinar ranking + costo real, calcular utilidad ───
  const result: TopProductRow[] = rankedRows.map((r) => {
    const totalQuantity = Number(r.totalQuantity)
    const totalRevenue = Number(r.totalRevenue)
    const totalCost = Math.round((costByProduct.get(r.productId) ?? 0) * 100) / 100
    const profit = Math.round((totalRevenue - totalCost) * 100) / 100
    const profitPct = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 10000) / 100 : 0

    return {
      productId: r.productId,
      productName: r.productName,
      productSku: r.productSku,
      unit: r.unit,
      totalQuantity,
      totalRevenue,
      totalCost,
      profit,
      profitPct,
      hasSales: true
    }
  })

  if (!includeUnsold) {
    setCached(cacheKey, result)
    return result
  }

  const needsFill = limit === 0 || result.length < limit
  if (!needsFill) {
    setCached(cacheKey, result)
    return result
  }

  // ─── Productos activos SIN ventas: costo de inventario, no COGS ───
  let storeIdForStock: number | undefined
  if (profile.role === 'empleado') storeIdForStock = profile.storeId ?? undefined
  else storeIdForStock = params.storeId

  const soldProductIds = new Set(rankedRows.map((r) => r.productId))

  const stockFilters = []
  if (storeIdForStock) stockFilters.push(eq(inventory.storeId, storeIdForStock))

  const avgCostAllTimeSubquery = db
    .select({
      productId: stockMovements.productId,
      avgUnitCost:
        sql<string>`sum(${stockMovements.quantity} * ${stockMovements.unitValue}) / nullif(sum(${stockMovements.quantity}), 0)`.as(
          'avg_unit_cost_all_time'
        )
    })
    .from(stockMovements)
    .where(eq(stockMovements.type, 'entrada'))
    .groupBy(stockMovements.productId)
    .as('avg_cost_all_time')

  const stockRows = await db
    .select({
      productId: products.id,
      productName: products.name,
      productSku: products.sku,
      unit: products.unit,
      stockQty: sql<string>`sum(${inventory.quantity})`,
      avgUnitCost: avgCostAllTimeSubquery.avgUnitCost
    })
    .from(products)
    .innerJoin(inventory, eq(inventory.productId, products.id))
    .leftJoin(avgCostAllTimeSubquery, eq(avgCostAllTimeSubquery.productId, products.id))
    .where(and(eq(products.isActive, true), ...stockFilters))
    .groupBy(
      products.id,
      products.name,
      products.sku,
      products.unit,
      avgCostAllTimeSubquery.avgUnitCost
    )

  let unsoldResult: TopProductRow[] = stockRows
    .filter((r) => !soldProductIds.has(r.productId))
    .map((r) => {
      const stockQty = Number(r.stockQty)
      const avgUnitCost = r.avgUnitCost != null ? Number(r.avgUnitCost) : 0
      return {
        productId: r.productId,
        productName: r.productName,
        productSku: r.productSku,
        unit: r.unit,
        totalQuantity: 0,
        totalRevenue: 0,
        totalCost: Math.round(stockQty * avgUnitCost * 100) / 100,
        profit: 0,
        profitPct: 0,
        hasSales: false
      }
    })

  if (limit > 0) {
    const slotsRemaining = limit - result.length
    unsoldResult = unsoldResult.slice(0, Math.max(0, slotsRemaining))
  }

  const finalResult = [...result, ...unsoldResult]
  setCached(cacheKey, finalResult)
  return finalResult
}

/** Totales agregados de lo vendido en el periodo (costo, venta, utilidad). */
export async function computeSoldTotals(
  params: Omit<TopProductsParams, 'limit' | 'includeUnsold'>
): Promise<{ totalCost: number; totalRevenue: number; totalProfit: number }> {
  const rows = await computeTopProducts({ ...params, limit: 0, includeUnsold: false })
  const totalRevenue = rows.reduce((sum, r) => sum + r.totalRevenue, 0)
  const totalCost = rows.reduce((sum, r) => sum + r.totalCost, 0)
  return {
    totalCost: Math.round(totalCost * 100) / 100,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalProfit: Math.round((totalRevenue - totalCost) * 100) / 100
  }
}
