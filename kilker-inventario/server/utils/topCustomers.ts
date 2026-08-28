// ───────────────────────────────────────────────
//  CLIENTES MÁS VENDIDOS + COSTO/UTILIDAD FIFO
// ───────────────────────────────────────────────
// Gemelo de `topProducts.ts`, pero agrupando por CLIENTE en vez de por
// producto: el costo es el de todos los productos que se le vendieron, la
// venta es lo que facturó y la utilidad la diferencia.
//
// Paso 1: top N clientes por facturación en la ventana (agregado en SQL sobre
//         `invoices.total_amount`, que ya trae el descuento aplicado).
// Paso 2: para los productos que compraron esos clientes, reconstruye el FIFO
//         completo (histórico entero, no la ventana: el costo de lo vendido
//         hoy depende de en qué estado quedaron las capas antes).
// Paso 3: reparte ese costo por LÍNEA de venta (`invoice_items.id`, vía
//         `saleCostByRef` del motor) y lo suma por cliente.
//
// ⚠️ Solo entran facturas CON cliente. Las ventas de mostrador sin cliente
// (`customer_id` null) no son un cliente, así que no compiten en el ranking —
// la consecuencia es que la suma de este listado NO tiene por qué dar la
// "Venta total" del dashboard.
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { useDb } from '../db'
import { customers, invoiceItems, invoices, stockMovements, transfers } from '../db/schema'
import { isStoreScopedRole, type SessionProfile } from './auth'
import { buildFifoEvents, runFifo } from './fifoEngine'

export interface TopCustomerRow {
  customerId: number
  customerName: string | null
  /** Facturas emitidas del cliente dentro de la ventana. */
  salesCount: number
  /** Unidades vendidas (suma de las líneas). */
  totalQuantity: number
  /** Facturado, ya con el descuento de factura aplicado y sin IVA. */
  totalRevenue: number
  /** Costo FIFO de todo lo que se le entregó. */
  totalCost: number
  profit: number
  profitPct: number
  /**
   * Parte de lo que se le vendió que salió contra capas de costo $0: su costo
   * suma 0 y la utilidad sale del 100%, pero por una entrada capturada sin
   * costo, no porque el cliente sea rentable. Ver `FifoResult.zeroCostSaleUnits`.
   */
  zeroCostUnits: number
}

// Mismo caché por-proceso y con el mismo TTL que top-products (ver la nota de
// multi-instancia allí).
const CACHE_TTL_MS = 60_000
const reportCache = new Map<string, { data: TopCustomerRow[]; expiresAt: number }>()

function getCached(key: string): TopCustomerRow[] | undefined {
  const hit = reportCache.get(key)
  if (!hit || hit.expiresAt < Date.now()) {
    if (hit) reportCache.delete(key)
    return undefined
  }
  return hit.data
}

export interface TopCustomersParams {
  profile: SessionProfile
  /** Sucursal solicitada. Se ignora para los roles acotados a tienda. */
  storeId?: number
  /** ISO date-time; límite inferior inclusivo sobre invoices.issued_at. */
  from?: string
  /** ISO date-time; límite superior exclusivo sobre invoices.issued_at. */
  to?: string
  /** 0 = sin límite (hasta 1000). */
  limit?: number
}

export async function computeTopCustomers(
  params: TopCustomersParams
): Promise<TopCustomerRow[]> {
  const { profile } = params
  const db = useDb()

  const filters = [eq(invoices.status, 'emitida'), isNotNull(invoices.customerId)]
  let storeId: number | undefined

  if (isStoreScopedRole(profile.role)) {
    if (profile.storeId == null) return []
    storeId = profile.storeId
  } else if (params.storeId) {
    storeId = params.storeId
  }
  if (storeId != null) filters.push(eq(invoices.storeId, storeId))

  const periodStart = params.from ? new Date(params.from) : null
  const periodEnd = params.to ? new Date(params.to) : new Date('9999-12-31')
  if (params.from) filters.push(gte(invoices.issuedAt, new Date(params.from)))
  if (params.to) filters.push(lt(invoices.issuedAt, new Date(params.to)))

  const limit = params.limit ?? 5

  const cacheKey = [
    'top-customers',
    `store:${storeId ?? 'all'}`,
    `from:${params.from ?? ''}`,
    `to:${params.to ?? ''}`,
    `limit:${limit}`
  ].join('|')

  const cached = getCached(cacheKey)
  if (cached) return cached

  // ─── Paso 1: top N por facturación ───
  // El ingreso sale de `invoices.total_amount` (una fila por factura), no de
  // sumar líneas: el descuento es de la FACTURA, así que sumar `line_total`
  // daría bruto y no cuadraría con la venta total del dashboard.
  const rankedRows = await db
    .select({
      customerId: invoices.customerId,
      customerName: customers.name,
      salesCount: sql<string>`count(*)`,
      totalRevenue: sql<string>`sum(${invoices.totalAmount})`
    })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(and(...filters))
    .groupBy(invoices.customerId, customers.name)
    .orderBy(desc(sql`sum(${invoices.totalAmount})`))
    .limit(limit > 0 ? limit : 1000)

  const topCustomerIds = rankedRows
    .map((r) => r.customerId)
    .filter((id): id is number => id != null)

  if (topCustomerIds.length === 0) {
    reportCache.set(cacheKey, { data: [], expiresAt: Date.now() + CACHE_TTL_MS })
    return []
  }

  // ─── Paso 2: líneas que esos clientes se llevaron en la ventana ───
  // Solo estas aportan costo y unidades; el FIFO de abajo las localiza por
  // `invoice_items.id`.
  const purchasedLines = await db
    .select({
      itemId: invoiceItems.id,
      customerId: invoices.customerId,
      productId: invoiceItems.productId,
      storeId: invoices.storeId,
      quantity: invoiceItems.quantity
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .where(and(...filters, inArray(invoices.customerId, topCustomerIds)))

  const customerByItem = new Map<number, number>()
  const quantityByCustomer = new Map<number, number>()
  const productIds = new Set<number>()
  for (const line of purchasedLines) {
    if (line.customerId == null) continue
    customerByItem.set(line.itemId, line.customerId)
    quantityByCustomer.set(
      line.customerId,
      (quantityByCustomer.get(line.customerId) ?? 0) + Number(line.quantity)
    )
    productIds.add(line.productId)
  }

  // productId -> costo/unidades $0 acumulados por cliente
  const costByCustomer = new Map<number, number>()
  const zeroCostByCustomer = new Map<number, number>()

  const productIdList = [...productIds]
  if (productIdList.length > 0) {
    const movementFilters = [inArray(stockMovements.productId, productIdList)]
    if (storeId != null) movementFilters.push(eq(stockMovements.storeId, storeId))

    // Sin filtro de fecha ni de cliente: el FIFO necesita TODAS las salidas del
    // producto para saber qué capa consumió cada una. Filtrar por cliente aquí
    // costearía sus compras contra capas que en realidad ya se había llevado
    // otro, e inflaría o hundiría el costo según el orden.
    const invoiceFiltersAllTime = [eq(invoices.status, 'emitida')]
    if (storeId != null) invoiceFiltersAllTime.push(eq(invoices.storeId, storeId))

    const [movementRows, salesRows] = await Promise.all([
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
          transferReceivedAt: transfers.receivedAt,
          transferStatus: transfers.status
        })
        .from(stockMovements)
        .leftJoin(transfers, eq(stockMovements.transferId, transfers.id))
        .where(and(...movementFilters)),

      db
        .select({
          itemId: invoiceItems.id,
          productId: invoiceItems.productId,
          storeId: invoices.storeId,
          issuedAt: invoices.issuedAt,
          quantity: invoiceItems.quantity,
          unitPrice: invoiceItems.unitPrice
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
        .where(
          and(...invoiceFiltersAllTime, inArray(invoiceItems.productId, productIdList))
        )
    ])

    const movementTypeById = new Map<number, string>()
    for (const m of movementRows) movementTypeById.set(m.id, m.type)

    type SaleLine = { itemId: number; issuedAt: Date; quantity: number; unitPrice: number }
    const salesByKey = new Map<string, SaleLine[]>()
    for (const row of salesRows) {
      const key = `${row.productId}-${row.storeId}`
      if (!salesByKey.has(key)) salesByKey.set(key, [])
      salesByKey.get(key)!.push({
        itemId: row.itemId,
        issuedAt: row.issuedAt,
        quantity: Number(row.quantity),
        unitPrice: Number(row.unitPrice)
      })
    }

    const movementsByKey = new Map<string, typeof movementRows>()
    for (const m of movementRows) {
      const key = `${m.productId}-${m.storeId}`
      if (!movementsByKey.has(key)) movementsByKey.set(key, [])
      movementsByKey.get(key)!.push(m)
    }

    for (const key of new Set([...movementsByKey.keys(), ...salesByKey.keys()])) {
      const productMovements = movementsByKey.get(key) ?? []
      const productSales = salesByKey.get(key) ?? []

      const fifo = runFifo(
        buildFifoEvents(
          productMovements.map((m) => ({
            id: m.id,
            type: m.type,
            quantity: m.quantity,
            unitValue: m.unitValue,
            supplierInvoiceDate: m.supplierInvoiceDate,
            reversesMovementId: m.reversesMovementId,
            createdAt: m.createdAt,
            transferIssuedAt: m.transferIssuedAt,
            transferReceivedAt: m.transferReceivedAt,
            transferStatus: m.transferStatus
          })),
          productSales.map((s) => ({
            issuedAt: s.issuedAt,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
            saleRef: s.itemId
          })),
          movementTypeById
        ),
        { from: periodStart ?? undefined, to: periodEnd }
      )

      // Aquí se cae del costo total del producto al costo por cliente: solo
      // las líneas de los clientes del ranking están en `customerByItem`.
      for (const [itemId, acc] of fifo.saleCostByRef) {
        const customerId = customerByItem.get(itemId)
        if (customerId == null) continue
        costByCustomer.set(customerId, (costByCustomer.get(customerId) ?? 0) + acc.cost)
        if (acc.zeroCostUnits > 0) {
          zeroCostByCustomer.set(
            customerId,
            (zeroCostByCustomer.get(customerId) ?? 0) + acc.zeroCostUnits
          )
        }
      }
    }
  }

  // ─── Paso 3: combinar ranking + costo real ───
  const result: TopCustomerRow[] = rankedRows
    .filter((r): r is typeof r & { customerId: number } => r.customerId != null)
    .map((r) => {
      const totalRevenue = Math.round(Number(r.totalRevenue) * 100) / 100
      const totalCost = Math.round((costByCustomer.get(r.customerId) ?? 0) * 100) / 100
      const profit = Math.round((totalRevenue - totalCost) * 100) / 100
      const profitPct = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 10000) / 100 : 0

      return {
        customerId: r.customerId,
        customerName: r.customerName,
        salesCount: Number(r.salesCount),
        totalQuantity: Math.round((quantityByCustomer.get(r.customerId) ?? 0) * 1000) / 1000,
        totalRevenue,
        totalCost,
        profit,
        profitPct,
        zeroCostUnits: Math.round((zeroCostByCustomer.get(r.customerId) ?? 0) * 100) / 100
      }
    })

  reportCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS })
  return result
}
