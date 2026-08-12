// GET /api/reports/inventory-value?storeId=&asOf=
// Valor de inventario "a hoy" (o a una fecha de corte) por producto y sucursal.
import { and, eq, lt } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices, stockMovements } from '../../db/schema'

const EPSILON = 0.0005 

interface Transaction {
  date: Date
  type: 'entrada' | 'salida'
  quantity: number
  unitValue: number
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const asOf = query.asOf ? new Date(String(query.asOf)) : new Date()
  if (Number.isNaN(asOf.getTime())) {
    throw createError({ statusCode: 400, statusMessage: 'Parámetro asOf inválido' })
  }

  let storeIds: number[] | undefined
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    storeIds = [profile.storeId]
  } else if (query.storeId) {
    const id = Number(query.storeId)
    if (id) storeIds = [id]
  }

  const db = useDb()

  const movementFilters = []
  if (storeIds && storeIds.length === 1) {
    movementFilters.push(eq(stockMovements.storeId, storeIds[0]!))
  }

  const allMovements = await db.query.stockMovements.findMany({
    where: movementFilters.length ? and(...movementFilters) : undefined,
    columns: {
      id: true, productId: true, storeId: true, type: true, quantity: true,
      unitValue: true, totalValue: true, supplierInvoiceDate: true,
      reversesMovementId: true, createdAt: true
    },
    with: { transfer: { columns: { issuedAt: true, receivedAt: true } } }
  })

  const movementTypeById = new Map(allMovements.map((m) => [m.id, m.type]))

  const invoiceFilters = [eq(invoices.status, 'emitida'), lt(invoices.issuedAt, asOf)]
  if (storeIds && storeIds.length === 1) {
    invoiceFilters.push(eq(invoices.storeId, storeIds[0]!))
  }
  const allInvoices = await db.query.invoices.findMany({
    where: and(...invoiceFilters),
    columns: { id: true, storeId: true, issuedAt: true },
    with: { items: { columns: { productId: true, quantity: true, unitPrice: true } } }
  })

  type SaleLine = { issuedAt: Date; quantity: number; unitValue: number }
  const salesByKey = new Map<string, SaleLine[]>()
  for (const invoice of allInvoices) {
    for (const item of invoice.items) {
      const key = `${item.productId}-${invoice.storeId}`
      if (!salesByKey.has(key)) salesByKey.set(key, [])
      salesByKey.get(key)!.push({
        issuedAt: invoice.issuedAt,
        quantity: Number(item.quantity),
        unitValue: Number(item.unitPrice)
      })
    }
  }

  const movementsByKey = new Map<string, typeof allMovements>()
  for (const m of allMovements) {
    const key = `${m.productId}-${m.storeId}`
    if (!movementsByKey.has(key)) movementsByKey.set(key, [])
    movementsByKey.get(key)!.push(m)
  }

  const allKeys = new Set<string>([...movementsByKey.keys(), ...salesByKey.keys()])
  const rows: Array<{ productId: number; storeId: number; endingUnits: number; endingValue: number }> = []

  for (const key of allKeys) {
    const [productIdStr, storeIdStr] = key.split('-')
    const productId = Number(productIdStr)
    const storeId = Number(storeIdStr)

    const productMovements = movementsByKey.get(key) ?? []
    const productSales = salesByKey.get(key) ?? []
    const transactions: Transaction[] = []

    for (const m of productMovements) {
      if (m.type === 'entrada') {
        const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
        if (date < asOf) transactions.push({ date, type: 'entrada', quantity: Number(m.quantity), unitValue: Number(m.unitValue) })
      }
      if (m.type === 'transferencia_entrada' && m.transfer?.receivedAt && m.transfer.receivedAt < asOf) {
        transactions.push({ date: m.transfer.receivedAt, type: 'entrada', quantity: Number(m.quantity), unitValue: Number(m.unitValue) })
      }
      if (m.type === 'transferencia_salida' && m.transfer?.issuedAt && m.transfer.issuedAt < asOf) {
        transactions.push({ date: m.transfer.issuedAt, type: 'salida', quantity: Math.abs(Number(m.quantity)), unitValue: Number(m.unitValue) })
      }
      if (m.type === 'anulacion' && m.createdAt < asOf) {
        const originalType = m.reversesMovementId ? movementTypeById.get(m.reversesMovementId) : undefined
        if (originalType === 'entrada') {
          transactions.push({ date: m.createdAt, type: 'salida', quantity: Math.abs(Number(m.quantity)), unitValue: Number(m.unitValue) })
        }
      }
      if (m.type === 'ajuste') {
        const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
        if (date < asOf) {
          const qty = Number(m.quantity)
          if (qty > 0) transactions.push({ date, type: 'entrada', quantity: qty, unitValue: Number(m.unitValue) })
          else if (qty < 0) transactions.push({ date, type: 'salida', quantity: Math.abs(qty), unitValue: Number(m.unitValue) })
        }
      }
    }

    for (const s of productSales) {
      if (s.issuedAt < asOf) transactions.push({ date: s.issuedAt, type: 'salida', quantity: s.quantity, unitValue: s.unitValue })
    }

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

    const layers: Array<{ qty: number; unitCost: number }> = []
    let remainingQty = 0

     for (const txn of transactions) {
      if (txn.type === 'entrada') {
        layers.push({ qty: txn.quantity, unitCost: txn.unitValue })
        remainingQty += txn.quantity
      } else {
        let qtyToConsume = txn.quantity
        let index = 0
        while (qtyToConsume > EPSILON && index < layers.length) {
          const layer = layers[index]
          if (!layer) break
          const consume = Math.min(layer.qty, qtyToConsume)
          layer.qty -= consume
          qtyToConsume -= consume
          remainingQty -= consume
          if (layer.qty <= EPSILON) index++
        }
        layers.splice(0, index)
        if (qtyToConsume > EPSILON) remainingQty -= qtyToConsume
      }
    }

    if (remainingQty === 0 && !layers.length) continue // sin existencia, no reportar

    const endingUnits = Math.round(remainingQty * 1000) / 1000
    const rawValue = layers.reduce((sum, l) => sum + l.qty * l.unitCost, 0)

    // Candado: si la existencia redondeada da 0, el valor SIEMPRE es 0 —
    // sin importar si quedó un residuo de punto flotante en `layers`.
    const endingValue = endingUnits === 0 ? 0 : Math.round(rawValue * 100) / 100

    if (endingUnits === 0 && endingValue === 0) continue // sin existencia, no reportar

    rows.push({ productId, storeId, endingUnits, endingValue })
  }

  return rows
})