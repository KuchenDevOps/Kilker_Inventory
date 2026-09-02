// GET /api/reports/inventory-value?storeId=&asOf=
// Valor de inventario "a hoy" (o a una fecha de corte) por producto y sucursal.
//
// ⚠️ El costeo NO se implementa aquí: se delega en `server/utils/fifoEngine.ts`,
// el mismo motor que valúa el dashboard. Este endpoint tenía su propia copia del
// FIFO y divergía justo donde más duele: una venta sin existencia solo restaba
// unidades y nunca dejaba deuda, así que la compra que la cubría entraba entera
// al valor y el catálogo valuaba 5 piezas al importe de 6. Contra la base real
// eso inflaba el total del catálogo en $440.81 frente al dashboard.
import { and, eq, lt } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices, stockMovements } from '../../db/schema'
import { buildFifoEvents, runFifo } from '../../utils/fifoEngine'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const asOf = query.asOf ? new Date(String(query.asOf)) : new Date()
  if (Number.isNaN(asOf.getTime())) {
    throw createError({ statusCode: 400, statusMessage: 'Parámetro asOf inválido' })
  }

  let storeIds: number[] | undefined
  if (isStoreScopedRole(profile.role)) {
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
    with: { transfer: { columns: { issuedAt: true, receivedAt: true, status: true } } }
  })

  // Qué tipo de movimiento revierte cada 'anulacion': el motor solo procesa las
  // que revierten una ENTRADA (la de una venta ya quedó fuera al filtrar
  // invoices.status = 'emitida').
  const movementTypeById = new Map(allMovements.map((m) => [m.id, m.type as string]))

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
          transferIssuedAt: m.transfer?.issuedAt ?? null,
          transferReceivedAt: m.transfer?.receivedAt ?? null,
          transferStatus: m.transfer?.status ?? null
        })),
        productSales.map((s) => ({
          issuedAt: s.issuedAt,
          quantity: s.quantity,
          unitPrice: s.unitValue
        })),
        movementTypeById
      ),
      { to: asOf }
    )

    const endingUnits = Math.round(fifo.endingUnits * 1000) / 1000

    // Candado: si la existencia redondeada da 0, el valor SIEMPRE es 0 —
    // sin importar si quedó un residuo de punto flotante en las capas.
    const endingValue = endingUnits === 0 ? 0 : Math.round(fifo.endingValue * 100) / 100

    if (endingUnits === 0 && endingValue === 0) continue // sin existencia, no reportar

    rows.push({ productId, storeId, endingUnits, endingValue })
  }

  return rows
})
