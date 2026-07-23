// GET /api/reports/monthly-inventory
import { and, eq, lt, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices, stockMovements } from '../../db/schema'

interface Transaction {
  date: Date
  type: 'entrada' | 'salida'
  quantity: number
  unitValue: number
  totalValue: number
}

const EMPTY_RESULT = {
  entriesValue: 0,
  exitsValue: 0,
  exitsUnits: 0,
  endingInventoryValue: 0,
  endingUnits: 0,
  productsWithStock: 0,
  transfersInUnits: 0,
  transfersInValue: 0,
  transfersOutUnits: 0,
  transfersOutValue: 0,
  voidsValue: 0,        
  voidsUnits: 0,        
  adjustmentsValue: 0,  
  adjustmentsUnits: 0,
}

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

  const db = useDb()

  // Sucursales a incluir: una específica, o todas las relevantes para el rol.
  let storeIds: number[] | undefined // undefined = sin restricción (se resuelve más abajo)
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return { month, ...EMPTY_RESULT }
    storeIds = [profile.storeId]
  } else if (query.storeId) {
    const id = Number(query.storeId)
    if (id) storeIds = [id]
  }
  // Si storeIds sigue undefined aquí, es admin viendo "todas las sucursales".

  const effectiveDate = sql`COALESCE(${stockMovements.supplierInvoiceDate}::timestamp, ${stockMovements.createdAt})`

  // --- 1. Movimientos hasta el cierre del mes (acota por fecha: evita traer
  //         historial completo sin límite conforme crece la base). ---
    const movementFilters = []
if (storeIds && storeIds.length === 1) {
  const singleStoreId = storeIds[0]
  if (singleStoreId != null) {
    movementFilters.push(eq(stockMovements.storeId, singleStoreId))
  }
}

const allMovements = await db.query.stockMovements.findMany({
  where: movementFilters.length ? and(...movementFilters) : undefined,
    columns: {
      id: true,
      productId: true,
      storeId: true,
      type: true,
      quantity: true,
      unitValue: true,
      totalValue: true,
      supplierInvoiceDate: true,
      invoiceId: true,
      createdAt: true
    },
    with: {
      transfer: { columns: { issuedAt: true, receivedAt: true } }
    }
  })

  // --- 2. Ventas emitidas hasta el cierre del mes, con sus líneas. ---
  const invoiceFilters = [eq(invoices.status, 'emitida'), lt(invoices.issuedAt, monthEnd)]
  if (storeIds && storeIds.length === 1) {
    const singleStoreId = storeIds[0]
    if (singleStoreId != null) {
      invoiceFilters.push(eq(invoices.storeId, singleStoreId))
    }
  }
  const allInvoicesUpToEnd = await db.query.invoices.findMany({
    where: and(...invoiceFilters),
    columns: { id: true, storeId: true, issuedAt: true },
    with: {
      items: { columns: { productId: true, quantity: true, unitPrice: true, lineTotal: true } }
    }
  })

  // --- 3. Agrupar TODO por (productId, storeId) — nunca solo por productId,
  //         para no mezclar el inventario físico de distintas sucursales
  //         en una sola cola FIFO. ---
  type SaleLine = { issuedAt: Date; quantity: number; totalValue: number; unitValue: number }
  const salesByKey = new Map<string, SaleLine[]>()
  for (const invoice of allInvoicesUpToEnd) {
    for (const item of invoice.items) {
      const key = `${item.productId}-${invoice.storeId}`
      if (!salesByKey.has(key)) salesByKey.set(key, [])
      salesByKey.get(key)!.push({
        issuedAt: invoice.issuedAt,
        quantity: Number(item.quantity),
        totalValue: Number(item.lineTotal),
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

  // Unión de todas las llaves (producto+sucursal) que tienen algún movimiento o venta.
  const allKeys = new Set<string>([...movementsByKey.keys(), ...salesByKey.keys()])

  // --- 4. Calcular métricas por (producto, sucursal), acumulando el total. ---
  let entriesValue = 0
  let endingInventoryValue = 0
  let productsWithStock = 0
  let transfersOutValue = 0
  let transfersOutUnits = 0
  let transfersInValue = 0
  let transfersInUnits = 0
  let endingUnits = 0
  let exitsValue = 0
  let exitsUnits = 0
  let voidsValue = 0
  let voidsUnits = 0
  let adjustmentsValue = 0
  let adjustmentsUnits = 0

  for (const key of allKeys) {
    const productMovements = movementsByKey.get(key) ?? []
    const productSales = salesByKey.get(key) ?? []

    const entries = productMovements
      .filter((m) => m.type === 'entrada')
      .sort((a, b) => {
        const dateA = a.supplierInvoiceDate ? new Date(a.supplierInvoiceDate) : a.createdAt
        const dateB = b.supplierInvoiceDate ? new Date(b.supplierInvoiceDate) : b.createdAt
        return dateA.getTime() - dateB.getTime()
      })

    const entriesInMonth = entries.filter((e) => {
      const date = e.supplierInvoiceDate ? new Date(e.supplierInvoiceDate) : e.createdAt
      return date >= monthStart && date < monthEnd
    })
    for (const e of entriesInMonth) entriesValue += Number(e.totalValue)

    for (const m of productMovements) {
      if (m.type === 'transferencia_salida') {
        const issuedAt = m.transfer?.issuedAt
        if (issuedAt && issuedAt >= monthStart && issuedAt < monthEnd) {
          transfersOutUnits += Math.abs(Number(m.quantity))
          transfersOutValue += Math.abs(Number(m.totalValue))
        }
      }
      if (m.type === 'transferencia_entrada') {
        const receivedAt = m.transfer?.receivedAt
        if (receivedAt && receivedAt >= monthStart && receivedAt < monthEnd) {
          transfersInUnits += Number(m.quantity)
          transfersInValue += Number(m.totalValue)
        }
      }
       if (m.type === 'anulacion') {
        if (m.createdAt >= monthStart && m.createdAt < monthEnd) {
          voidsUnits += Math.abs(Number(m.quantity))
          voidsValue += Math.abs(Number(m.totalValue))
        }
      }

      // ← NUEVO: ajustes ocurridos este mes
      if (m.type === 'ajuste') {
        const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
        if (date >= monthStart && date < monthEnd) {
          adjustmentsUnits += Number(m.quantity) // conserva el signo, útil para ver si fue alta o baja
          adjustmentsValue += Number(m.totalValue)
        }
      }
    }

    const salesInMonth = productSales.filter((s) => s.issuedAt >= monthStart && s.issuedAt < monthEnd)
    for (const s of salesInMonth) {
      exitsValue += s.totalValue
      exitsUnits += s.quantity
    }

    // --- FIFO acotado a esta sucursal específica ---
    const transactions: Transaction[] = []

    for (const e of entries) {
      const date = e.supplierInvoiceDate ? new Date(e.supplierInvoiceDate) : e.createdAt
      if (date >= monthEnd) continue
      transactions.push({
        date,
        type: 'entrada',
        quantity: Number(e.quantity),
        unitValue: Number(e.unitValue),
        totalValue: Number(e.totalValue)
      })
    }

    for (const s of productSales) {
      if (s.issuedAt >= monthEnd) continue
      transactions.push({ date: s.issuedAt, type: 'salida', quantity: s.quantity, unitValue: s.unitValue, totalValue: s.totalValue })
    }

    for (const m of productMovements) {
      if (m.type === 'transferencia_entrada') {
        const receivedAt = m.transfer?.receivedAt
        if (receivedAt && receivedAt < monthEnd) {
          transactions.push({
            date: receivedAt,
            type: 'entrada',
            quantity: Number(m.quantity),
            unitValue: Number(m.unitValue),
            totalValue: Number(m.totalValue)
          })
        }
      }
      if (m.type === 'transferencia_salida') {
        const issuedAt = m.transfer?.issuedAt
        if (issuedAt && issuedAt < monthEnd) {
          transactions.push({
            date: issuedAt,
            type: 'salida',
            quantity: Math.abs(Number(m.quantity)),
            unitValue: Number(m.unitValue),
            totalValue: Math.abs(Number(m.totalValue))
          })
        }
      }
        if (m.type === 'anulacion' && m.createdAt < monthEnd) {
    transactions.push({
      date: m.createdAt,
      type: 'salida',
      quantity: Math.abs(Number(m.quantity)),
      unitValue: Number(m.unitValue),
      totalValue: Math.abs(Number(m.totalValue))
    })
  }

  // ← NUEVO: el ajuste puede sumar o restar stock según el signo de quantity.
    if (m.type === 'ajuste') {
      const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
      if (date < monthEnd) {
        const qty = Number(m.quantity)
        if (qty > 0) {
          transactions.push({
            date,
            type: 'entrada',
            quantity: qty,
            unitValue: Number(m.unitValue),
            totalValue: Number(m.totalValue)
          })
        } else if (qty < 0) {
          transactions.push({
            date,
            type: 'salida',
            quantity: Math.abs(qty),
            unitValue: Number(m.unitValue),
            totalValue: Math.abs(Number(m.totalValue))
          })
        }
      }
    }

    }

    transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

    let remainingQty = 0
    const inventoryLayers: Array<{ qty: number; unitCost: number }> = []
    let shortfall = 0 // cantidad que no se pudo consumir por falta de capas (dato inconsistente)

    for (const txn of transactions) {
      if (txn.type === 'entrada') {
        inventoryLayers.push({ qty: txn.quantity, unitCost: txn.unitValue })
        remainingQty += txn.quantity
      } else {
        let qtyToConsume = txn.quantity
        let index = 0
        while (qtyToConsume > 0 && index < inventoryLayers.length) {
          const layer = inventoryLayers[index]
          if(!layer) break
          const consumeQty = Math.min(layer.qty, qtyToConsume)
          layer.qty -= consumeQty
          qtyToConsume -= consumeQty
          remainingQty -= consumeQty
          if (layer.qty === 0) index++
        }
        inventoryLayers.splice(0, index)
        if (qtyToConsume > 0) {
          // Salida mayor a lo disponible en capas: dato inconsistente (mismo
          // patrón de "stock fantasma" visto antes). Se registra pero no se
          // detiene el cálculo del resto de productos.
          shortfall += qtyToConsume
          remainingQty -= qtyToConsume // evita que quede negativo lógicamente
        }
      }
    }

    if (shortfall > 0) {
      console.warn(
        `[monthly-inventory] Faltante de capas FIFO para llave "${key}": ${shortfall} unidad(es) sin entrada que las respalde antes de ${month}.`
      )
    }

    let productInventoryValue = 0
    for (const layer of inventoryLayers) productInventoryValue += layer.qty * layer.unitCost

    endingInventoryValue += productInventoryValue
    if (remainingQty > 0) {
      endingUnits += remainingQty
      productsWithStock++
    }
  }

  return {
    month,
    entriesValue: Math.round(entriesValue * 100) / 100,
    exitsValue: Math.round(exitsValue * 100) / 100,
    exitsUnits: Math.round(exitsUnits * 100) / 100,
    endingInventoryValue: Math.round(endingInventoryValue * 100) / 100,
    endingUnits: Math.round(endingUnits * 100) / 100,
    transfersOutValue: Math.round(transfersOutValue * 100) / 100,
    transfersOutUnits: Math.round(transfersOutUnits * 100) / 100,
    transfersInValue: Math.round(transfersInValue * 100) / 100,
    transfersInUnits: Math.round(transfersInUnits * 100) / 100,
     voidsValue: Math.round(voidsValue * 100) / 100,          
    voidsUnits: Math.round(voidsUnits * 100) / 100,           
    adjustmentsUnits: Math.round(adjustmentsUnits * 100) / 100, 
    adjustmentsValue: Math.round(adjustmentsValue * 100) / 100, 
    productsWithStock
  }
})