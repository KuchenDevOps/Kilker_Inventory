// server/api/average-costs/index.get.ts
import { eq, sql, and, desc, gte, lt, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { inventory, stockMovements, products, stores } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)
  
  const db = useDb()

  // Construir filtros base
  const storeFilters = []
  
  // Empleado solo ve su tienda
  if (profile.role === 'empleado') {
    if (profile.storeId == null) {
      return []
    }
    storeFilters.push(eq(inventory.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) {
      storeFilters.push(eq(inventory.storeId, storeId))
    }
  }

  // Obtener el inventario actual (cantidades disponibles por producto/sucursal)
  // Solo productos con stock > 0
  const inventoryItems = await db.query.inventory.findMany({
    where: (inv, { and, gt }) => {
      const conditions = [gt(inv.quantity, 0)]
      if (storeFilters.length > 0) {
        conditions.push(and(...storeFilters))
      }
      return and(...conditions)
    },
    with: {
      product: {
        columns: {
          id: true,
          name: true,
          sku: true,
          cost: true,
          price: true
        }
      },
      store: {
        columns: {
          id: true,
          code: true,
          name: true
        }
      }
    }
  })

  // Si no hay inventario, retornar array vacío
  if (inventoryItems.length === 0) {
    return []
  }

  // Procesar cada producto/sucursal para calcular el costo promedio FIFO
  const results = await Promise.all(
    inventoryItems.map(async (inv) => {
      const productId = inv.productId
      const storeId = inv.storeId
      const availableQty = Number(inv.quantity)

      if (availableQty === 0) {
        return null
      }

      // 1. Obtener TODAS las entradas de este producto/sucursal, ordenadas por fecha (FIFO)
      const entries = await db.query.stockMovements.findMany({
        where: (mov, { and, eq }) => and(
          eq(mov.productId, productId),
          eq(mov.storeId, storeId),
          eq(mov.type, 'entrada')
        ),
        orderBy: (mov, { asc }) => [asc(mov.supplierInvoiceDate), asc(mov.createdAt)],
        columns: {
          id: true,
          quantity: true,
          unitValue: true,
          totalValue: true,
          supplierInvoiceDate: true,
          createdAt: true
        }
      })
      // Si no hay entradas, usar el costo del producto
      if (entries.length === 0) {
        return {
          productId,
          storeId,
          productName: inv.product.name,
          productSku: inv.product.sku,
          storeCode: inv.store?.code,
          storeName: inv.store?.name,
          avgCost: Number(inv.product.cost ?? 0),
          availableQty,
          totalCost: Number(inv.product.cost ?? 0) * availableQty,
          entriesCount: 0,
          method: 'fallback'
        }
      }

      // 2. Obtener TODAS las salidas (ventas y ajustes negativos) de este producto/sucursal
        const outputs = await db.query.stockMovements.findMany({
          where: (mov, { and, eq, or }) => and(
            eq(mov.productId, productId),
            eq(mov.storeId, storeId),
            or(
              eq(mov.type, 'venta'),
              eq(mov.type, 'ajuste')
            )
          ),
          orderBy: (mov, { asc }) => [asc(mov.supplierInvoiceDate), asc(mov.createdAt)],
          columns: {
            id: true,
            quantity: true,
            supplierInvoiceDate: true,
            createdAt: true
          }
        })

    // 3. Aplicar FIFO (First In, First Out)
      const totalEntradas = entries.reduce((sum, e) => sum + Number(e.quantity), 0)
      // Cantidad que salió del stock de forma permanente = todo lo que entró
      // menos lo que efectivamente queda ahora (ya neto de ventas, ajustes,
      // anulaciones, o cualquier tipo futuro de movimiento).
      let remainingToSell = Math.max(0, totalEntradas - availableQty)
      let totalCost = 0
      let totalQty = 0
      let usedEntries = 0

      if (remainingToSell === 0) {
        for (const entry of entries) {
          const entryQty = Number(entry.quantity)
          const entryUnitValue = Number(entry.unitValue)
          totalCost += entryQty * entryUnitValue
          totalQty += entryQty
          usedEntries++
        }
      } else {
        for (const entry of entries) {
          const entryQty = Number(entry.quantity)
          const entryUnitValue = Number(entry.unitValue)
          let availableFromThisEntry = entryQty
          if (remainingToSell > 0) {
            const consumed = Math.min(availableFromThisEntry, remainingToSell)
            availableFromThisEntry -= consumed
            remainingToSell -= consumed
          }
          if (availableFromThisEntry > 0) {
            totalCost += availableFromThisEntry * entryUnitValue
            totalQty += availableFromThisEntry
            usedEntries++
          }
          if (remainingToSell <= 0 && totalQty >= availableQty) {
            break
          }
        }
      }

      // Verificar que el total calculado coincida con el stock disponible
      // Si hay diferencias (por redondeo o datos inconsistentes), ajustar
      let finalAvgCost = 0
      let finalTotalCost = 0

      if (totalQty > 0) {
        finalAvgCost = totalCost / totalQty
        finalTotalCost = finalAvgCost * availableQty
      } else {
        // Si no se pudo calcular, usar el costo del producto
        finalAvgCost = Number(inv.product.cost ?? 0)
        finalTotalCost = finalAvgCost * availableQty
      }

      // Redondear a 2 decimales para evitar problemas de precisión
      const roundedAvgCost = Math.round(finalAvgCost * 100) / 100
      const roundedTotalCost = Math.round(finalTotalCost * 100) / 100

      return {
        productId,
        storeId,
        productName: inv.product.name,
        productSku: inv.product.sku,
        storeCode: inv.store?.code,
        storeName: inv.store?.name,
        avgCost: roundedAvgCost,
        availableQty,
        totalCost: roundedTotalCost,
        entriesCount: entries.length,
        outputsCount: outputs.length,
        usedEntries,
        method: totalQty > 0 ? 'fifo' : 'fallback'
      }
    })
  )

  // Filtrar nulos y devolver
  const filteredResults = results.filter(r => r !== null)

  // Log para depuración (opcional, eliminar en producción)

  return filteredResults
})