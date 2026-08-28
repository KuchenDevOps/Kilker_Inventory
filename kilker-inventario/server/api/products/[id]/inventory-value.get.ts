// GET /api/products/:id/inventory-value
// Reconstruye el FIFO del producto (por sucursal) usando TODO su historial
// hasta hoy. A diferencia de /api/reports/monthly-inventory, esto solo trae
// movimientos e invoice-items de ESTE producto, así que es barato incluso
// llamado bajo demanda desde el catálogo.
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../db'
import { invoiceItems, invoices, stockMovements } from '../../../db/schema'
import { voidEffectiveDate } from '../../../utils/fifoEngine'
import { effectiveMovementDate } from '../../../utils/movementDates'

const EPSILON = 0.0005

interface Transaction {
  date: Date
  type: 'entrada' | 'salida'
  quantity: number
  unitValue: number
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const productId = Number(getRouterParam(event, 'id'))
  if (!productId) {
    throw createError({ statusCode: 400, statusMessage: 'id de producto inválido' })
  }

  const db = useDb()
  const now = new Date()

  const movements = await db.query.stockMovements.findMany({
    where: eq(stockMovements.productId, productId),
    columns: {
      id: true,
      storeId: true,
      type: true,
      quantity: true,
      unitValue: true,
      totalValue: true,
      supplierInvoiceDate: true,
      reversesMovementId: true,
      createdAt: true
    },
    with: { transfer: { columns: { issuedAt: true, receivedAt: true, status: true } } }
  })

  const movementTypeById = new Map(movements.map((m) => [m.id, m.type]))
  // Para fechar cada anulación con la entrada que revierte (ver voidEffectiveDate).
  const movementById = new Map(movements.map((m) => [m.id, m]))

  // Ventas emitidas de este producto (join manual porque el filtro es por producto,
  // no por invoice).
  const items = await db.query.invoiceItems.findMany({
    where: eq(invoiceItems.productId, productId),
    columns: { quantity: true, unitPrice: true, invoiceId: true }
  })
  const invoiceIds = [...new Set(items.map((i) => i.invoiceId))]
  const relatedInvoices = invoiceIds.length
    ? await db.query.invoices.findMany({
        where: and(eq(invoices.status, 'emitida'), inArray(invoices.id, invoiceIds)),
        columns: { id: true, storeId: true, issuedAt: true }
      })
    : []
  const invoiceById = new Map(relatedInvoices.map((inv) => [inv.id, inv]))

  // Agrupar por sucursal — mismo principio que en monthly-inventory: nunca
  // mezclar el FIFO físico de una sucursal con el de otra.
  const movementsByStore = new Map<number, typeof movements>()
  for (const m of movements) {
    if (!movementsByStore.has(m.storeId)) movementsByStore.set(m.storeId, [])
    movementsByStore.get(m.storeId)!.push(m)
  }

  const salesByStore = new Map<number, Array<{ issuedAt: Date; quantity: number; unitValue: number }>>()
  for (const item of items) {
    const invoice = invoiceById.get(item.invoiceId)
    if (!invoice) continue // anulada o no encontrada
    if (!salesByStore.has(invoice.storeId)) salesByStore.set(invoice.storeId, [])
    salesByStore.get(invoice.storeId)!.push({
      issuedAt: invoice.issuedAt,
      quantity: Number(item.quantity),
      unitValue: Number(item.unitPrice)
    })
  }

  const storeIds = new Set([...movementsByStore.keys(), ...salesByStore.keys()])
  const byStore: Array<{ storeId: number; endingUnits: number; endingValue: number }> = []

  for (const storeId of storeIds) {
    const storeMovements = movementsByStore.get(storeId) ?? []
    const storeSales = salesByStore.get(storeId) ?? []

    const transactions: Transaction[] = []

    for (const m of storeMovements) {
      // Transferencia cancelada: se ignoran la salida y su reversa, para que
      // el FIFO quede como si nunca hubiera salido (mismo criterio que
      // monthlyInventory y inventoryFifo).
      if (m.transfer?.status === 'cancelada') continue

      if (m.type === 'entrada') {
        const date = effectiveMovementDate(m)
        transactions.push({ date, type: 'entrada', quantity: Number(m.quantity), unitValue: Number(m.unitValue) })
      }
      if (m.type === 'transferencia_entrada' && m.transfer?.receivedAt) {
        transactions.push({
          date: m.transfer.receivedAt,
          type: 'entrada',
          quantity: Number(m.quantity),
          unitValue: Number(m.unitValue)
        })
      }
      if (m.type === 'transferencia_salida' && m.transfer?.issuedAt) {
        transactions.push({
          date: m.transfer.issuedAt,
          type: 'salida',
          quantity: Math.abs(Number(m.quantity)),
          unitValue: Number(m.unitValue)
        })
      }
      if (m.type === 'anulacion') {
        const originalType = m.reversesMovementId ? movementTypeById.get(m.reversesMovementId) : undefined
        if (originalType === 'entrada') {
          transactions.push({
            // Fecha de la entrada que revierte, igual que el motor FIFO.
            date: voidEffectiveDate(
              m,
              m.reversesMovementId != null ? movementById.get(m.reversesMovementId) : undefined
            ),
            type: 'salida',
            quantity: Math.abs(Number(m.quantity)),
            unitValue: Number(m.unitValue)
          })
        }
      }
      if (m.type === 'ajuste') {
        const date = effectiveMovementDate(m)
        const qty = Number(m.quantity)
        if (qty > 0) transactions.push({ date, type: 'entrada', quantity: qty, unitValue: Number(m.unitValue) })
        else if (qty < 0) transactions.push({ date, type: 'salida', quantity: Math.abs(qty), unitValue: Number(m.unitValue) })
      }
    }

    for (const s of storeSales) {
      transactions.push({ date: s.issuedAt, type: 'salida', quantity: s.quantity, unitValue: s.unitValue })
    }

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

   const layers: Array<{ qty: number; unitCost: number }> = []
    let remainingQty = 0

    for (const txn of transactions) {
      if (txn.date > now) continue
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

    const roundedRemainingQty = Math.round(remainingQty * 1000) / 1000
    const rawValue = layers.reduce((sum, l) => sum + l.qty * l.unitCost, 0)
    const endingValue = roundedRemainingQty === 0 ? 0 : Math.round(rawValue * 100) / 100

    byStore.push({
      storeId,
      endingUnits: roundedRemainingQty,
      endingValue
    })
}
  return {
    productId,
    byStore,
    totalEndingUnits: Math.round(byStore.reduce((s, r) => s + r.endingUnits, 0) * 100) / 100,
    totalEndingValue: Math.round(byStore.reduce((s, r) => s + r.endingValue, 0) * 100) / 100
  }
})