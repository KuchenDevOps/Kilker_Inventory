
import { parseBusinessDate } from './businessTime'

const EPSILON = 0.0005

export interface FifoEvent {
  date: Date
  direction: 'in' | 'out'
  /** Siempre positiva; el sentido lo da `direction`. */
  quantity: number
  /** Costo unitario en las entradas. En las salidas es informativo. */
  unitValue: number
  /** Solo las ventas reales aportan al costo de lo vendido. */
  isSale: boolean
  /** Id del movimiento de entrada, para poder anular su capa exacta. */
  movementId?: number | null
  /** Anulación de entrada: id de la entrada que revierte. */
  reversesEntryId?: number | null
}

export interface FifoWindow {
  /** Inclusivo. Sin él, el costo se acumula desde el principio del histórico. */
  from?: Date
  /** EXCLUSIVO: instante al que se valúa el inventario. */
  to?: Date
}

export interface FifoResult {
  /** Valor de las capas al inicio de la ventana (`from`). */
  openingValue: number
  openingUnits: number
  /** Valor de las capas al corte. Negativo = se vendió lo que no había. */
  endingValue: number
  endingUnits: number
  /** Valor que ENTRÓ al inventario dentro de la ventana (compras, transferencias recibidas, ajustes +). */
  inflowValue: number
  /** Costo FIFO consumido por VENTAS dentro de la ventana. */
  saleCost: number
  /** Costo consumido por salidas que no son venta (transferencias, anulaciones, ajustes). */
  otherOutflowCost: number
  /** Unidades vendidas dentro de la ventana sin capa que las respalde. */
  uncoveredUnits: number
  /** Costo asignado a esas unidades (el de la compra que las cubrió). */
  uncoveredValue: number
  /**
   * Unidades vendidas dentro de la ventana que consumieron una capa de costo
   * CERO. No es lo mismo que `uncoveredUnits`: aquí sí había existencia, pero
   * la entrada que la creó se capturó sin costo, así que esa venta entra al
   * costo de lo vendido en $0 y su utilidad sale del 100%.
   *
   * No se corrige inventándole un costo —el valor del inventario sale de esas
   * mismas capas y quedaría descuadrado—: se reporta para que la utilidad no
   * se lea como real. El arreglo de fondo es capturar el costo de la entrada.
   */
  zeroCostSaleUnits: number
  /** Ingreso (a precio de línea, sin prorratear descuento) de esas unidades. */
  zeroCostSaleRevenue: number
  /** Capas vivas al corte, de la más antigua a la más nueva. */
  layers: FifoLayer[]
}

export interface FifoLayer {
  qty: number
  unitCost: number
}

interface Layer {
  qty: number
  unitCost: number
  movementId?: number | null
}

interface Debt {
  index: number
  layer: Layer
}

interface WalkOutput {
  layers: Layer[]
  openingValue: number
  openingUnits: number
  /** Por evento con faltante: cuánto se pagó y a qué costo. */
  paidByEvent: Map<number, { qty: number; cost: number }>
  /**
   * Por evento de salida: costo consumido, unidades sin respaldo y unidades
   * que salieron contra una capa de costo cero.
   */
  outflowByEvent: Map<number, { cost: number; uncovered: number; zeroCost: number }>
  firstEntryCost: number
}

/** Cronológico; a igual instante entra primero lo que suma stock. */
function sortEvents(events: FifoEvent[]): FifoEvent[] {
  return [...events].sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime()
    if (diff !== 0) return diff
    if (a.direction === b.direction) return 0
    return a.direction === 'in' ? -1 : 1
  })
}

/** Quita capas ya saldadas para que el frente del arreglo sea siempre útil. */
function prune(layers: Layer[]): void {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer && Math.abs(layer.qty) <= EPSILON) layers.splice(i, 1)
  }
}

function walk(
  events: FifoEvent[],
  deficitCosts: Map<number, number> | null,
  fallbackUnitCost: number,
  /** Corte exclusivo. El recorrido se detiene ahí, pero los índices siguen
   *  siendo los del arreglo completo, para que ambas pasadas coincidan. */
  cutoff?: Date,
  /** Instante en que se fotografía el inventario de apertura. */
  openingAt?: Date
): WalkOutput {
  const layers: Layer[] = []
  const debts: Debt[] = []
  const paidByEvent = new Map<number, { qty: number; cost: number }>()
  const outflowByEvent = new Map<number, { cost: number; uncovered: number; zeroCost: number }>()
  let lastEntryCost = 0
  let firstEntryCost = 0
  let opening: { value: number; units: number } | null = null

  const snapshot = () => {
    let value = 0
    let units = 0
    for (const layer of layers) {
      value += layer.qty * layer.unitCost
      units += layer.qty
    }
    return { value, units }
  }

  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (!event) continue
    if (cutoff && event.date.getTime() >= cutoff.getTime()) break
    // El inventario de apertura es el estado justo antes del primer
    // movimiento de la ventana.
    if (openingAt && !opening && event.date.getTime() >= openingAt.getTime()) {
      opening = snapshot()
    }

    if (event.direction === 'in') {
      lastEntryCost = event.unitValue
      if (firstEntryCost === 0) firstEntryCost = event.unitValue

      // La mercancía que llega salda primero lo que ya se vendió de más.
      let pending = event.quantity
      while (pending > EPSILON && debts.length) {
        const debt = debts[0]
        if (!debt) break
        const take = Math.min(pending, -debt.layer.qty)
        debt.layer.qty += take
        pending -= take
        const acc = paidByEvent.get(debt.index) ?? { qty: 0, cost: 0 }
        acc.qty += take
        acc.cost += take * event.unitValue
        paidByEvent.set(debt.index, acc)
        if (debt.layer.qty > -EPSILON) debts.shift()
      }

      if (pending > EPSILON) {
        layers.push({ qty: pending, unitCost: event.unitValue, movementId: event.movementId })
      }
      prune(layers)
      continue
    }

    let remaining = event.quantity
    let cost = 0
    // Unidades que salieron contra una capa que vale $0. Se rastrea aparte
    // porque en el costo se vuelven invisibles: suman 0 y no hay forma de
    // distinguirlas después de una venta legítimamente barata.
    let zeroCost = 0

    // Anulación de entrada: se revierte la capa de esa entrada concreta.
    if (event.reversesEntryId != null) {
      const own = layers.find(
        (l) => l.movementId != null && l.movementId === event.reversesEntryId && l.qty > EPSILON
      )
      if (own) {
        const take = Math.min(own.qty, remaining)
        own.qty -= take
        remaining -= take
        cost += take * own.unitCost
      }
    }

    // Resto: FIFO desde la capa más antigua.
    for (const layer of layers) {
      if (remaining <= EPSILON) break
      if (layer.qty <= EPSILON) continue
      const take = Math.min(layer.qty, remaining)
      layer.qty -= take
      remaining -= take
      cost += take * layer.unitCost
      if (Math.abs(layer.unitCost) <= EPSILON) zeroCost += take
    }

    // Sin capa que lo respalde: queda como deuda, costeada con la compra que
    // la cubra (segunda pasada) y no con el precio de venta.
    let uncovered = 0
    if (remaining > EPSILON) {
      const resolved = deficitCosts?.get(index)
      const unitCost = resolved ?? (lastEntryCost || fallbackUnitCost)
      const layer: Layer = { qty: -remaining, unitCost }
      layers.push(layer)
      debts.push({ index, layer })
      cost += remaining * unitCost
      uncovered = remaining
    }

    outflowByEvent.set(index, { cost, uncovered, zeroCost })
    prune(layers)
  }

  // Sin movimientos dentro de la ventana, la apertura es el estado final.
  if (!opening) opening = snapshot()

  return {
    layers,
    openingValue: opening.value,
    openingUnits: opening.units,
    paidByEvent,
    outflowByEvent,
    firstEntryCost
  }
}

/**
 * Recorre el histórico de UN par (producto, sucursal) y devuelve el valor al
 * corte y el costo consumido dentro de la ventana. `to` es exclusivo.
 */
export function runFifo(
  allEvents: FifoEvent[],
  window: FifoWindow = {},
  /** Último recurso cuando nada respalda un faltante (p. ej. `products.cost`). */
  fallbackUnitCost = 0
): FifoResult {
  const { from, to } = window
  const events = sortEvents(allEvents)

  // Pasada 1: sobre TODO el histórico, para saber con qué costo termina
  // pagándose cada faltante. Truncarla aquí haría que el mismo faltante se
  // valuara distinto según el mes desde el que se mire, y el inventario de
  // un mes dejaría de empalmar con el inicial del siguiente.
  const first = walk(events, null, fallbackUnitCost)
  const deficitCosts = new Map<number, number>()
  for (const [index, acc] of first.paidByEvent) {
    if (acc.qty > EPSILON) deficitCosts.set(index, acc.cost / acc.qty)
  }

  // Pasada 2: valúa al corte, ya con las deudas costeadas.
  const final = walk(events, deficitCosts, fallbackUnitCost || first.firstEntryCost, to, from)

  let endingValue = 0
  let endingUnits = 0
  for (const layer of final.layers) {
    endingValue += layer.qty * layer.unitCost
    endingUnits += layer.qty
  }

  let inflowValue = 0
  for (const event of events) {
    if (event.direction !== 'in') continue
    if (from && event.date.getTime() < from.getTime()) continue
    if (to && event.date.getTime() >= to.getTime()) continue
    inflowValue += event.quantity * event.unitValue
  }

  let saleCost = 0
  let otherOutflowCost = 0
  let uncoveredUnits = 0
  let uncoveredValue = 0
  let zeroCostSaleUnits = 0
  let zeroCostSaleRevenue = 0
  for (const [index, outflow] of final.outflowByEvent) {
    const event = events[index]
    if (!event) continue
    if (from && event.date.getTime() < from.getTime()) continue
    if (event.isSale) {
      saleCost += outflow.cost
      if (outflow.uncovered > 0) {
        uncoveredUnits += outflow.uncovered
        const unitCost = deficitCosts.get(index) ?? 0
        uncoveredValue += outflow.uncovered * unitCost
      }
      if (outflow.zeroCost > 0) {
        zeroCostSaleUnits += outflow.zeroCost
        // `unitValue` de un evento de venta es el precio de la línea: sirve
        // para dimensionar cuánto ingreso quedó sin costo enfrente.
        zeroCostSaleRevenue += outflow.zeroCost * event.unitValue
      }
    } else {
      otherOutflowCost += outflow.cost
    }
  }

  return {
    layers: final.layers.map((l) => ({ qty: l.qty, unitCost: l.unitCost })),
    openingValue: final.openingValue,
    openingUnits: final.openingUnits,
    endingValue,
    endingUnits,
    inflowValue,
    saleCost,
    otherOutflowCost,
    uncoveredUnits,
    uncoveredValue,
    zeroCostSaleUnits,
    zeroCostSaleRevenue
  }
}

export { EPSILON as FIFO_EPSILON }

/** Movimiento de stock, con los datos mínimos que necesita el FIFO. */
export interface FifoMovementRow {
  id: number
  type: string
  quantity: string | number
  unitValue: string | number
  supplierInvoiceDate: string | null
  reversesMovementId: number | null
  createdAt: Date
  transferIssuedAt?: Date | null
  transferReceivedAt?: Date | null
  transferStatus?: string | null
}

/** Línea de venta de una factura EMITIDA. */
export interface FifoSaleRow {
  issuedAt: Date
  quantity: string | number
  unitPrice: string | number
}

/** Misma regla que `effectiveMovementDate`, sin arrastrar el esquema aquí. */
function ownEffectiveDate(m: {
  supplierInvoiceDate: string | null
  createdAt: Date
}): Date {
  return m.supplierInvoiceDate ? parseBusinessDate(m.supplierInvoiceDate) : m.createdAt
}

/**
 * Fecha con la que una ANULACIÓN DE ENTRADA entra al kardex valuado: **la de
 * la entrada que revierte**, no la de captura.
 *
 * Anular dice "esta entrada nunca ocurrió", así que sacarla en su propia fecha
 * es lo único que deja el histórico como si nunca hubiera existido. Con
 * `created_at` la entrada vive en el FIFO entre que se captura y que se anula,
 * y cualquier salida en ese hueco se lleva su capa: una entrada capturada en
 * $0 y anulada dos semanas después dejaba que una venta se costeara en cero y
 * después cobraba el importe real a "Otras salidas". El total cuadraba, pero
 * el costo de lo vendido salía subvaluado y la utilidad inflada.
 *
 * ⚠️ Efecto secundario asumido: anular hoy una entrada de un mes ya cerrado
 * **cambia los números de ese mes**. Es la misma tensión que las ventas
 * retroactivas vs. cortes de caja (ver docs/CONTEXTO.md → "Preguntas
 * abiertas"); aquí se eligió la veracidad del costeo.
 *
 * Si no se encuentra la entrada original, cae a la fecha del propio
 * movimiento: es el comportamiento anterior y nunca es peor.
 */
export function voidEffectiveDate(
  voidMovement: { supplierInvoiceDate: string | null; createdAt: Date },
  original: { supplierInvoiceDate: string | null; createdAt: Date } | undefined
): Date {
  return ownEffectiveDate(original ?? voidMovement)
}

/**
 * Traduce movimientos y ventas de un (producto, sucursal) a eventos FIFO.
 * Vive aquí para que valuación y costeo no puedan volver a interpretar el
 * kardex con reglas distintas.
 */
export function buildFifoEvents(
  movements: FifoMovementRow[],
  sales: FifoSaleRow[],
  movementTypeById: Map<number, string>
): FifoEvent[] {
  const events: FifoEvent[] = []

  // Índice local para fechar cada anulación con la entrada que revierte. Vive
  // aquí y no en el `movementTypeById` de los llamadores porque la entrada y su
  // anulación son siempre del mismo producto y la misma sucursal, así que
  // ambas están en ESTE arreglo: no hace falta que nadie pase nada más.
  const movementById = new Map<number, FifoMovementRow>()
  for (const m of movements) movementById.set(m.id, m)

  for (const m of movements) {
    // Transferencia cancelada: se ignoran sus dos patas. Es como si nunca
    // hubiera salido, que es lo que significa cancelarla.
    if (m.transferStatus === 'cancelada') continue

    const quantity = Number(m.quantity)
    const unitValue = Number(m.unitValue)
    const effective = ownEffectiveDate(m)

    if (m.type === 'entrada') {
      events.push({
        date: effective,
        direction: 'in',
        quantity,
        unitValue,
        isSale: false,
        movementId: m.id
      })
      continue
    }

    if (m.type === 'transferencia_entrada' && m.transferReceivedAt) {
      events.push({
        date: m.transferReceivedAt,
        direction: 'in',
        quantity,
        unitValue,
        isSale: false,
        movementId: m.id
      })
      continue
    }

    if (m.type === 'transferencia_salida' && m.transferIssuedAt) {
      events.push({
        date: m.transferIssuedAt,
        direction: 'out',
        quantity: Math.abs(quantity),
        unitValue,
        isSale: false
      })
      continue
    }

    if (m.type === 'anulacion') {
      // Solo la anulación de una ENTRADA toca el FIFO. La de una venta ya
      // quedó resuelta al excluir la factura anulada, y la de una
      // transferencia se descartó arriba con la transferencia entera.
      const originalType = m.reversesMovementId
        ? movementTypeById.get(m.reversesMovementId)
        : undefined
      if (originalType === 'entrada') {
        const original =
          m.reversesMovementId != null ? movementById.get(m.reversesMovementId) : undefined
        events.push({
          // La entrada y su anulación quedan en el MISMO instante, y
          // `sortEvents` mete primero lo que suma stock: así la anulación
          // siempre encuentra viva su propia capa y la revierte al costo con
          // que entró, en vez de morder la más antigua.
          date: voidEffectiveDate(m, original),
          direction: 'out',
          quantity: Math.abs(quantity),
          unitValue,
          isSale: false,
          reversesEntryId: m.reversesMovementId
        })
      }
      continue
    }

    if (m.type === 'ajuste' && Math.abs(quantity) > EPSILON) {
      events.push({
        date: effective,
        direction: quantity > 0 ? 'in' : 'out',
        quantity: Math.abs(quantity),
        unitValue,
        isSale: false,
        movementId: quantity > 0 ? m.id : undefined
      })
    }
  }

  for (const s of sales) {
    events.push({
      date: s.issuedAt,
      direction: 'out',
      quantity: Number(s.quantity),
      unitValue: Number(s.unitPrice),
      isSale: true
    })
  }

  return events
}
