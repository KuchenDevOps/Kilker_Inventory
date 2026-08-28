// ───────────────────────────────────────────────
//  VALUACIÓN DE INVENTARIO POR MES (FIFO)
// ───────────────────────────────────────────────
// desde /api/dashboard/summary sin duplicar la lógica de costeo. El endpoint
// quedó como envoltorio delgado; la lógica de aquí es la misma, sin cambios
// de cálculo.
import { and, eq, lt } from 'drizzle-orm'
import { useDb } from '../db'
import { invoices, stockMovements } from '../db/schema'
import { isStoreScopedRole, type SessionProfile } from './auth'
import { parseBusinessDate } from './businessTime'
import { buildFifoEvents, runFifo, voidEffectiveDate } from './fifoEngine'
import { effectiveMovementDate } from './movementDates'

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
  openingInventoryValue: 0,
  openingUnits: 0,
  inflowsValue: 0,
  soldCost: 0,
  otherOutflowsCost: 0,
  uncoveredSaleUnits: 0,
  uncoveredSaleValue: 0
}

const EPSILON = 0.0005

/**
 * Día en que arranca la conciliación acumulada del dashboard.
 *
 * Las 208 entradas de inventario inicial (factura `'II'`) están fechadas el
 * **31-dic-2025** y son lo más viejo del kardex, así que el 1-ene-2026 es el
 * instante en que ese inventario ya está cargado y todavía no se ha movido
 * nada. Anclando ahí, el primer renglón de "Cómo se llegó al inventario final"
 * **es** el inventario inicial ($291,957.68) y los demás renglones son todo lo
 * que ha pasado desde entonces hasta el corte.
 *
 * ⚠️ Si algún día se captura un movimiento anterior a esta fecha, quedaría
 * fuera de la conciliación: hay que mover la constante, no parchear la tarjeta.
 */
export const INVENTORY_OPENING_DATE = '2026-01-01'

/** `from`/`to` son la ventana realmente usada (ISO); `to` es EXCLUSIVO. */
export type MonthlyInventoryWindow = { from: string; to: string } & typeof EMPTY_RESULT

export type MonthlyInventoryResult = { month: string } & MonthlyInventoryWindow & {
    /**
     * Los mismos flujos, pero acumulados desde `INVENTORY_OPENING_DATE` hasta
     * el MISMO corte. Alimenta "Cómo se llegó al inventario final": la ventana
     * del periodo responde "qué pasó en agosto", ésta responde "cómo llegó el
     * almacén a valer lo que vale". Sale del mismo `SELECT` y del mismo motor
     * FIFO — no es una segunda consulta.
     */
    reconciliation: MonthlyInventoryWindow
  }

export interface MonthlyInventoryParams {
  profile: SessionProfile
  /** Formato YYYY-MM. Ya validado por quien llama. */
  month: string
  /** Sucursal solicitada (admin). Se ignora para empleados. */
  storeId?: number
  /**
   * Ventana de valuación explícita (ISO), con `to` EXCLUSIVO. Cuando viene, el
   * corte deja de ser el fin de mes y pasa a ser ese instante: sirve para
   * valuar el inventario "hasta el día X" (p. ej. el último día del rango
   * elegido en el dashboard) en vez de solo al cierre del mes. Cada una que
   * falte se completa con el mes de `month`.
   */
  from?: string
  to?: string
}

function parseIsoDate(value?: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** `2026-08` → `2026-09-01`. Diciembre rueda al enero siguiente. */
function nextMonthOf(month: string): string {
  const [year = 0, mon = 0] = month.split('-').map(Number)
  const rollsOver = mon === 12
  const nextYear = rollsOver ? year + 1 : year
  const next = rollsOver ? 1 : mon + 1
  return `${nextYear}-${String(next).padStart(2, '0')}-01`
}

export async function computeMonthlyInventory(
  params: MonthlyInventoryParams
): Promise<MonthlyInventoryResult> {
  const { profile, month } = params

  // ⚠️ Los límites del mes van en HORA DEL NEGOCIO (UTC−6), no en UTC. En UTC
  // el mes arrancaba seis horas antes: las ventas de la tarde-noche del último
  // día caían en el mes siguiente, y el rótulo del dashboard —que formatea en
  // hora local— mostraba un día menos ("valor al 30 jul" para un corte que era
  // el 31). Es exactamente la mezcla de reglas que documenta businessTime.ts, y
  // la misma que ya usa el filtro de periodo que arma el navegador.
  const monthStart = parseBusinessDate(`${month}-01`)
  const monthEnd = parseBusinessDate(nextMonthOf(month))

  // Ventana de valuación: el periodo explícito si vino, o el mes completo.
  // `windowEnd` es el corte al que se valúa el inventario (exclusivo).
  const windowStart = parseIsoDate(params.from) ?? monthStart
  const windowEnd = parseIsoDate(params.to) ?? monthEnd

  const windowMeta = { from: windowStart.toISOString(), to: windowEnd.toISOString() }

  // Arranque de la conciliación acumulada. Se topa al corte por si alguien
  // valúa un periodo anterior a la carga inicial: ahí la ventana queda vacía
  // (apertura = final, flujos en cero), que es lo correcto, en vez de un rango
  // invertido que devolvería basura.
  const openingDate = parseBusinessDate(INVENTORY_OPENING_DATE)
  const reconcileStart = openingDate < windowEnd ? openingDate : windowEnd
  const reconcileMeta = {
    from: reconcileStart.toISOString(),
    to: windowEnd.toISOString()
  }

  const db = useDb()

  // Sucursales a incluir: una específica, o todas las relevantes para el rol.
  let storeIds: number[] | undefined // undefined = sin restricción (se resuelve más abajo)
  if (isStoreScopedRole(profile.role)) {
    if (profile.storeId == null) {
      return {
        month,
        ...windowMeta,
        ...EMPTY_RESULT,
        reconciliation: { ...reconcileMeta, ...EMPTY_RESULT }
      }
    }
    storeIds = [profile.storeId]
  } else if (params.storeId) {
    storeIds = [params.storeId]
  }
  // Si storeIds sigue undefined aquí, es admin viendo "todas las sucursales".

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
      reversesMovementId: true,
      createdAt: true
    },
    with: {
      transfer: { columns: { issuedAt: true, receivedAt: true, status: true } }
    }
  })

  // Mapa id -> type, para saber qué tipo de movimiento revierte cada 'anulacion'.
  // Necesario porque 'anulacion' se usa tanto para revertir una 'entrada' (que
  // sigue viva en el FIFO y hay que cancelar) como para revertir una 'venta'
  // (que ya fue excluida del FIFO al filtrar invoices.status = 'emitida', así
  // que procesarla de nuevo aquí sería doble conteo).
  const movementTypeById = new Map<number, string>()
  const movementById = new Map<number, (typeof allMovements)[number]>()
  for (const m of allMovements) {
    movementTypeById.set(m.id, m.type)
    movementById.set(m.id, m)
  }

  // --- 2. Ventas emitidas hasta el cierre del mes, con sus líneas. ---
  const invoiceFilters = [eq(invoices.status, 'emitida'), lt(invoices.issuedAt, windowEnd)]
  if (storeIds && storeIds.length === 1) {
    const singleStoreId = storeIds[0]
    if (singleStoreId != null) {
      invoiceFilters.push(eq(invoices.storeId, singleStoreId))
    }
  }
  const allInvoicesUpToEnd = await db.query.invoices.findMany({
    where: and(...invoiceFilters),
    columns: { id: true, storeId: true, issuedAt: true, discountPct: true },
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
    // El descuento vive en la factura, no en la línea: se prorratea para que
    // `exitsValue` sea el ingreso NETO y cuadre con `sum(total_amount)` del
    // dashboard. `unitValue` se deja bruto a propósito: es el precio snapshot
    // de la línea, y el FIFO no lo usa para valuar salidas.
    const netFactor = 1 - Number(invoice.discountPct ?? 0) / 100
    for (const item of invoice.items) {
      const key = `${item.productId}-${invoice.storeId}`
      if (!salesByKey.has(key)) salesByKey.set(key, [])
      salesByKey.get(key)!.push({
        issuedAt: invoice.issuedAt,
        quantity: Number(item.quantity),
        totalValue: Number(item.lineTotal) * netFactor,
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
  // Todo lo de arriba (dos SELECT y el agrupado) se hace UNA vez y sirve para
  // cualquier ventana: lo único que cambia entre el periodo elegido y la
  // conciliación acumulada es qué se atribuye a qué rango. Por eso esto es una
  // función y no un bloque suelto — antes de tenerla, una segunda ventana
  // habría significado volver a traer todo el kardex.
  function summarizeWindow(winFrom: Date, winTo: Date): typeof EMPTY_RESULT {
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
    // Flujos del FIFO: con ellos cuadra inicial + entradas − consumos = final.
    let openingInventoryValue = 0
    let openingUnits = 0
    let inflowsValue = 0
    let soldCost = 0
    let otherOutflowsCost = 0
    let uncoveredSaleUnits = 0
    let uncoveredSaleValue = 0

    for (const key of allKeys) {
      const productMovements = movementsByKey.get(key) ?? []
      const productSales = salesByKey.get(key) ?? []

      const entries = productMovements
        .filter((m) => m.type === 'entrada')
        .sort(
          (a, b) => effectiveMovementDate(a).getTime() - effectiveMovementDate(b).getTime()
        )

      const entriesInMonth = entries.filter((e) => {
        const date = effectiveMovementDate(e)
        return date >= winFrom && date < winTo
      })
      for (const e of entriesInMonth) entriesValue += Number(e.totalValue)

      for (const m of productMovements) {
        // Transferencia cancelada: no cuenta como salida (inflaba
        // transfersOut*) ni su reversa como ajuste/anulación. Se ignoran todos
        // sus movimientos, que es lo que significa cancelarla.
        if (m.transfer?.status === 'cancelada') continue

        if (m.type === 'transferencia_salida') {
          const issuedAt = m.transfer?.issuedAt
          if (issuedAt && issuedAt >= winFrom && issuedAt < winTo) {
            transfersOutUnits += Math.abs(Number(m.quantity))
            transfersOutValue += Math.abs(Number(m.totalValue))
          }
        }
        if (m.type === 'transferencia_entrada') {
          const receivedAt = m.transfer?.receivedAt
          if (receivedAt && receivedAt >= winFrom && receivedAt < winTo) {
            transfersInUnits += Number(m.quantity)
            transfersInValue += Number(m.totalValue)
          }
        }

        // Anulaciones: solo cuentan aquí como corrección de inventario si
        // revierten una 'entrada'. Si revierten una 'venta', su efecto ya
        // quedó resuelto al excluir la venta anulada del filtro de invoices.
        if (m.type === 'anulacion') {
          const originalType = m.reversesMovementId
            ? movementTypeById.get(m.reversesMovementId)
            : undefined

          if (originalType === 'entrada') {
            // ⚠️ Misma fecha que usa el FIFO (`voidEffectiveDate`): la de la
            // entrada que se revierte, no `created_at`. Con dos reglas
            // distintas, una anulación caía en un periodo para el desglose y
            // en otro para el costo — exactamente lo que este helper existe
            // para impedir.
            const date = voidEffectiveDate(
              m,
              m.reversesMovementId != null ? movementById.get(m.reversesMovementId) : undefined
            )
            if (date >= winFrom && date < winTo) {
              voidsUnits += Number(m.quantity) // negativo: resta stock
              voidsValue += Number(m.totalValue)
            }
          }
          // originalType === 'venta' (o desconocido): se ignora aquí.
        }

        // El ajuste puede sumar o restar stock según el signo de quantity.
        if (m.type === 'ajuste') {
          const date = effectiveMovementDate(m)
          if (date >= winFrom && date < winTo) {
            adjustmentsUnits += Number(m.quantity) // conserva el signo, útil para ver si fue alta o baja
            adjustmentsValue += Number(m.totalValue)
          }
        }
      }

      const salesInMonth = productSales.filter((s) => s.issuedAt >= winFrom && s.issuedAt < winTo)
      for (const s of salesInMonth) {
        exitsValue += s.totalValue
        exitsUnits += s.quantity
      }

      // --- FIFO de esta sucursal, con el motor compartido ---
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
        { from: winFrom, to: winTo }
      )

      endingInventoryValue += fifo.endingValue
      openingInventoryValue += fifo.openingValue
      if (fifo.openingUnits > EPSILON) openingUnits += fifo.openingUnits
      inflowsValue += fifo.inflowValue
      soldCost += fifo.saleCost
      otherOutflowsCost += fifo.otherOutflowCost
      uncoveredSaleUnits += fifo.uncoveredUnits
      uncoveredSaleValue += fifo.uncoveredValue
      if (fifo.endingUnits > EPSILON) {
        endingUnits += fifo.endingUnits
        productsWithStock++
      }
    }

    return {
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
      openingInventoryValue: Math.round(openingInventoryValue * 100) / 100,
      openingUnits: Math.round(openingUnits * 100) / 100,
      inflowsValue: Math.round(inflowsValue * 100) / 100,
      soldCost: Math.round(soldCost * 100) / 100,
      otherOutflowsCost: Math.round(otherOutflowsCost * 100) / 100,
      uncoveredSaleUnits: Math.round(uncoveredSaleUnits * 100) / 100,
      uncoveredSaleValue: Math.round(uncoveredSaleValue * 100) / 100,
      productsWithStock
    }
  }

  return {
    month,
    ...windowMeta,
    ...summarizeWindow(windowStart, windowEnd),
    // Segunda pasada sobre los MISMOS datos ya cargados: la conciliación no
    // arranca en el periodo elegido sino en la carga del inventario inicial,
    // para que la tarjeta cuente la historia completa hasta el corte.
    reconciliation: {
      ...reconcileMeta,
      ...summarizeWindow(reconcileStart, windowEnd)
    }
  }
}
