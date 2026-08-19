// server/utils/inventoryFifo.ts
//
// Cálculo de costo FIFO compartido entre endpoints (transferencias, reportes)
// y scripts de corrección. 
import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db'
import { invoiceItems, invoices, stockMovements } from '../db/schema'
import { buildFifoEvents, runFifo } from './fifoEngine'
import type { FifoLayer } from './fifoEngine'

/** Transacción Drizzle (el `tx` que entrega `db.transaction(...)`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const EPSILON = 0.0005

export type { FifoLayer } from './fifoEngine'


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
    with: { transfer: { columns: { issuedAt: true, receivedAt: true, status: true } } }
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

  const events = buildFifoEvents(
    movements.map((m) => ({
      id: m.id,
      type: m.type,
      quantity: m.quantity,
      unitValue: m.unitValue,
      supplierInvoiceDate: m.supplierInvoiceDate,
      reversesMovementId: m.reversesMovementId,
      createdAt: m.createdAt,
      transferIssuedAt: m.transfer?.issuedAt ?? null,
      transferReceivedAt: m.transfer?.receivedAt ?? null,
      transferStatus: m.transfer?.status ?? null
    })),
    items.flatMap((item) => {
      const invoice = invoiceById.get(item.invoiceId)
      return invoice
        ? [{ issuedAt: invoice.issuedAt, quantity: item.quantity, unitPrice: item.unitPrice }]
        : []
    }),
    movementTypeById
  )

  // `asOf` es inclusivo aquí (así lo usaban los llamadores), y el motor corta
  // en exclusivo: se le suma 1 ms.
  const cutoff = new Date(asOf.getTime() + 1)
    return runFifo(events, { to: cutoff }).layers
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
    // Una capa negativa es deuda (se vendió sin existencia), no inventario
    // disponible: no puede costear una salida.
    if (layer.qty <= EPSILON) continue
    const take = Math.min(layer.qty, remaining)
    totalCost += take * layer.unitCost
    remaining -= take
  }

  const covered = quantityNeeded - Math.max(remaining, 0)
  if (covered <= EPSILON) return 0
  return totalCost / covered
}