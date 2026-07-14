// GET /api/reports/monthly-inventory
import { and, asc, eq, gte, lt, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices, stockMovements } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const month = String(query.month ?? '')
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw createError({ statusCode: 400, statusMessage: 'Parámetro month requerido (formato YYYY-MM)' })
  }

  const monthStart = new Date(`${month}-01T00:00:00Z`)
  const monthEnd = new Date(monthStart)
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1)

  const monthStartStr = monthStart.toISOString().slice(0, 10)
  const monthEndStr = monthEnd.toISOString().slice(0, 10)

  const db = useDb()

  let storeId: number | undefined
  if (profile.role === 'empleado') {
    if (profile.storeId == null) {
      return { month, entriesValue: 0, exitsValue: 0, endingInventoryValue: 0, productsWithStock: 0 }
    }
    storeId = profile.storeId
  } else if (query.storeId) {
    storeId = Number(query.storeId) || undefined
  }

  // IMPORTANTE: ya NO filtramos por supplierInvoiceDate aquí.
  // Ese filtro se aplicaba a TODOS los tipos de movimiento, pero solo
  // 'entrada' tiene supplierInvoiceDate poblado; 'venta' y 'anulacion'
  // vienen con NULL, así que `lt(...)` las descartaba silenciosamente.
  const movementFilters = []
  if (storeId) movementFilters.push(eq(stockMovements.storeId, storeId))

  const allMovements = await db.query.stockMovements.findMany({
    where: movementFilters.length > 0 ? and(...movementFilters) : undefined,
    orderBy: [asc(stockMovements.supplierInvoiceDate), asc(stockMovements.createdAt)],
    columns: {
      productId: true,
      storeId: true,
      type: true,
      quantity: true,
      unitValue: true,
      totalValue: true,
      supplierInvoiceDate: true,
      createdAt: true
    },
    with: { product: { columns: { name: true, sku: true, cost: true } } }
  })

  // Agrupar por producto × sucursal
  const groups = new Map<string, typeof allMovements>()
  for (const m of allMovements) {
    const key = `${m.productId}-${m.storeId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }

  let entriesValue = 0
  let endingInventoryValue = 0
  let productsWithStock = 0

  for (const movs of groups.values()) {
    // Recorte "hasta el cierre del mes", por tipo:
    // - entrada: usa supplierInvoiceDate (fecha de factura del proveedor)
    // - venta/anulacion: usa createdAt, porque no tienen supplierInvoiceDate
    const cutoffMovs = movs.filter((m) => {
      if (m.type === 'entrada') {
        return m.supplierInvoiceDate
          ? m.supplierInvoiceDate < monthEndStr
          : m.createdAt < monthEnd
      }
      return m.createdAt < monthEnd
    })

    // Entradas ocurridas DENTRO del mes (según supplierInvoiceDate)
    for (const m of cutoffMovs) {
      if (
        m.type === 'entrada' &&
        m.supplierInvoiceDate &&
        m.supplierInvoiceDate >= monthStartStr &&
        m.supplierInvoiceDate < monthEndStr
      ) {
        entriesValue += Number(m.totalValue)
      }
    }

    // Cantidad neta acumulada hasta el cierre del mes
    const netQty = cutoffMovs.reduce((sum, m) => sum + Number(m.quantity), 0)
    if (netQty <= 0) continue

    // FIFO usando solo movimientos hasta ese corte
   const entries = cutoffMovs.filter((m) => m.type === 'entrada')
    const totalEntradas = entries.reduce((sum, e) => sum + Number(e.quantity), 0)
    let remainingToSell = Math.max(0, totalEntradas - netQty)

    let totalCost = 0
    let totalQty = 0
    if (remainingToSell === 0) {
      for (const e of entries) {
        totalCost += Number(e.quantity) * Number(e.unitValue)
        totalQty += Number(e.quantity)
      }
    } else {
      for (const e of entries) {
        let avail = Number(e.quantity)
        if (remainingToSell > 0) {
          const consumed = Math.min(avail, remainingToSell)
          avail -= consumed
          remainingToSell -= consumed
        }
        if (avail > 0) {
          totalCost += avail * Number(e.unitValue)
          totalQty += avail
        }
      }
    }

    const avgCost = totalQty > 0 ? totalCost / totalQty : Number(movs[0]?.product?.cost ?? 0)
    endingInventoryValue += avgCost * netQty
    productsWithStock++
  }

  const invoiceFilters = [
    eq(invoices.status, 'emitida'),
    gte(invoices.issuedAt, monthStart),
    lt(invoices.issuedAt, monthEnd)
  ]
  if (storeId) invoiceFilters.push(eq(invoices.storeId, storeId))

  const monthSales = await db.query.invoices.findMany({
    where: and(...invoiceFilters),
    columns: { totalAmount: true }
  })
  const exitsValue = monthSales.reduce((sum, s) => sum + Number(s.totalAmount), 0)

  return {
    month,
    entriesValue: Math.round(entriesValue * 100) / 100,
    exitsValue: Math.round(exitsValue * 100) / 100,
    endingInventoryValue: Math.round(endingInventoryValue * 100) / 100,
    productsWithStock
  }
})