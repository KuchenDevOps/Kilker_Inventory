// GET /api/products/:id/inventory-value
// Reconstruye el FIFO del producto (por sucursal) usando TODO su historial
// hasta hoy. A diferencia de /api/reports/monthly-inventory, esto solo trae
// movimientos e invoice-items de ESTE producto, así que es barato incluso
// llamado bajo demanda desde el catálogo.
//
// ⚠️ El costeo se delega en `server/utils/fifoEngine.ts`, igual que el
// dashboard y que /api/reports/inventory-value: este archivo llevaba su propia
// copia del FIFO y sobrevaluaba cualquier producto que se hubiera vendido sin
// existencia (el faltante restaba unidades pero no valor, así que la compra que
// lo cubría entraba entera al inventario).
import { and, eq, inArray } from 'drizzle-orm'
import { useDb } from '../../../db'
import { invoiceItems, invoices, stockMovements } from '../../../db/schema'
import { buildFifoEvents, runFifo } from '../../../utils/fifoEngine'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
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

  const movementTypeById = new Map(movements.map((m) => [m.id, m.type as string]))

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

    const fifo = runFifo(
      buildFifoEvents(
        storeMovements.map((m) => ({
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
        storeSales.map((s) => ({
          issuedAt: s.issuedAt,
          quantity: s.quantity,
          unitPrice: s.unitValue
        })),
        movementTypeById
      ),
      { to: now }
    )

    const endingUnits = Math.round(fifo.endingUnits * 1000) / 1000
    const endingValue = endingUnits === 0 ? 0 : Math.round(fifo.endingValue * 100) / 100

    byStore.push({ storeId, endingUnits, endingValue })
  }

  return {
    productId,
    byStore,
    totalEndingUnits: Math.round(byStore.reduce((s, r) => s + r.endingUnits, 0) * 100) / 100,
    totalEndingValue: Math.round(byStore.reduce((s, r) => s + r.endingValue, 0) * 100) / 100
  }
})
