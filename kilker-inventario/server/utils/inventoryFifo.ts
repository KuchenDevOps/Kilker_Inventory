// server/utils/inventoryFifo.ts
//
// Cálculo de costo FIFO compartido entre endpoints (transferencias, reportes)
// y scripts de corrección. 
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db'
import { invoiceItems, invoices, stockMovements } from '../db/schema'

/** Transacción Drizzle (el `tx` que entrega `db.transaction(...)`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const EPSILON = 0.0005

export interface FifoLayer {
  qty: number
  unitCost: number
}


export async function getFifoLayers(
  tx: Tx,
  productId: number,
  storeId: number,
  asOf: Date = new Date()
): Promise<FifoLayer[]> {
  const movements = await tx.query.stockMovements.findMany({
    where: and(eq(stockMovements.productId, productId), eq(stockMovements.storeId, storeId)),
    columns: {
      id: true, type: true, quantity: true, unitValue: true,
      supplierInvoiceDate: true, reversesMovementId: true, createdAt: true
    },
    with: { transfer: { columns: { issuedAt: true, receivedAt: true } } }
  })

  const movementTypeById = new Map(movements.map((m) => [m.id, m.type]))

  const items = await tx.query.invoiceItems.findMany({
    where: eq(invoiceItems.productId, productId),
    columns: { quantity: true, unitPrice: true, invoiceId: true }
  })
  const invoiceIds = [...new Set(items.map((i) => i.invoiceId))]
  const relatedInvoices = invoiceIds.length
    ? await tx.query.invoices.findMany({
        where: and(eq(invoices.status, 'emitida'), eq(invoices.storeId, storeId), inArray(invoices.id, invoiceIds)),
        columns: { id: true, issuedAt: true }
      })
    : []
  const invoiceById = new Map(relatedInvoices.map((inv) => [inv.id, inv]))

  type Txn = { date: Date; type: 'entrada' | 'salida'; quantity: number; unitValue: number }
  const transactions: Txn[] = []

  for (const m of movements) {
    if (m.type === 'entrada') {
      const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
      transactions.push({ date, type: 'entrada', quantity: Number(m.quantity), unitValue: Number(m.unitValue) })
    }
    if (m.type === 'transferencia_entrada' && m.transfer?.receivedAt) {
      transactions.push({ date: m.transfer.receivedAt, type: 'entrada', quantity: Number(m.quantity), unitValue: Number(m.unitValue) })
    }
    if (m.type === 'transferencia_salida' && m.transfer?.issuedAt) {
      transactions.push({ date: m.transfer.issuedAt, type: 'salida', quantity: Math.abs(Number(m.quantity)), unitValue: Number(m.unitValue) })
    }
    if (m.type === 'anulacion') {
      const originalType = m.reversesMovementId ? movementTypeById.get(m.reversesMovementId) : undefined
      if (originalType === 'entrada') {
        transactions.push({ date: m.createdAt, type: 'salida', quantity: Math.abs(Number(m.quantity)), unitValue: Number(m.unitValue) })
      }
    }
    if (m.type === 'ajuste') {
      const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
      const qty = Number(m.quantity)
      if (qty > 0) transactions.push({ date, type: 'entrada', quantity: qty, unitValue: Number(m.unitValue) })
      else if (qty < 0) transactions.push({ date, type: 'salida', quantity: Math.abs(qty), unitValue: Number(m.unitValue) })
    }
  }
  for (const item of items) {
    const invoice = invoiceById.get(item.invoiceId)
    if (!invoice) continue
    transactions.push({ date: invoice.issuedAt, type: 'salida', quantity: Number(item.quantity), unitValue: Number(item.unitPrice) })
  }

  transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

  const layers: FifoLayer[] = []
  for (const txn of transactions) {
    if (txn.date > asOf) continue
    if (txn.type === 'entrada') {
      layers.push({ qty: txn.quantity, unitCost: txn.unitValue })
    } else {
      let qtyToConsume = txn.quantity
      let index = 0
      while (qtyToConsume > EPSILON && index < layers.length) {
        const layer = layers[index]
        if (!layer) break
        const consume = Math.min(layer.qty, qtyToConsume)
        layer.qty -= consume
        qtyToConsume -= consume
        if (layer.qty <= EPSILON) index++
      }
      layers.splice(0, index)
    }
  }

  return layers
}

/**
 * Costo unitario ponderado de las `quantityNeeded` unidades que se
 * consumirían ahora mismo (FIFO, desde la capa más antigua). Úsalo para
 * valuar una venta, transferencia o cualquier salida de inventario.
 */
export async function getFifoUnitCost(
  tx: Tx,
  productId: number,
  storeId: number,
  quantityNeeded: number,
  asOf: Date = new Date()
): Promise<number> {
  const layers = await getFifoLayers(tx, productId, storeId, asOf)

  let remaining = quantityNeeded
  let totalCost = 0
  for (const layer of layers) {
    if (remaining <= EPSILON) break
    const take = Math.min(layer.qty, remaining)
    totalCost += take * layer.unitCost
    remaining -= take
  }

  const covered = quantityNeeded - Math.max(remaining, 0)
  if (covered <= EPSILON) return 0
  return totalCost / covered
}