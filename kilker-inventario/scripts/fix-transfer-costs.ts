// scripts/fix-transfer-costs.ts
//
// Corrige movimientos 'transferencia_salida'/'transferencia_entrada' que se
// guardaron con unit_value = 0 (bug: usaban product.cost estático en vez del
// costo FIFO real). Reconstruye la línea de tiempo COMPLETA de cada producto
// afectado, a través de todas sus sucursales, y recalcula cada transferencia
// exactamente como debió calcularse en su momento.
//
// Uso:
//   npx tsx scripts/fix-transfer-costs.ts             (dry-run: solo imprime)
//   npx tsx scripts/fix-transfer-costs.ts --apply      (aplica los cambios)
import 'dotenv/config' // carga .env → process.env
import { and, eq, inArray, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../server/db/schema'
import { invoiceItems, invoices, stockMovements } from '../server/db/schema'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('Falta DATABASE_URL en tu .env — no se puede correr el script sin conexión a la base.')
}

// Mismo patrón que server/db/index.ts: prepare:false por el pooler Supavisor.
const client = postgres(databaseUrl, { prepare: false })
const db = drizzle(client, { schema })

const EPSILON = 0.0005
const isApply = process.argv.includes('--apply')

type EventKind = 'entrada' | 'venta' | 'salida_transfer' | 'entrada_transfer' | 'anulacion_salida' | 'ajuste'

interface TimelineEvent {
  kind: EventKind
  date: Date
  storeId: number
  quantity: number // siempre positivo
  unitValue?: number // conocido para entrada/ajuste; para venta no importa
  movementId?: number // solo para salida_transfer / entrada_transfer
  transferId?: number // solo para salida_transfer / entrada_transfer
}

interface PendingUpdate {
  movementId: number
  productId: number
  storeId: number
  type: string
  oldUnitValue: number
  newUnitValue: number
  quantityAbs: number
}

async function buildTimeline(productId: number): Promise<TimelineEvent[]> {
  const movements = await db.query.stockMovements.findMany({
    where: eq(stockMovements.productId, productId),
    columns: {
      id: true, storeId: true, type: true, quantity: true, unitValue: true,
      supplierInvoiceDate: true, reversesMovementId: true, createdAt: true, transferId: true
    }
  })
  const movementTypeById = new Map(movements.map((m: any) => [m.id, m.type]))

  const items = await db.query.invoiceItems.findMany({
    where: eq(invoiceItems.productId, productId),
    columns: { quantity: true, invoiceId: true }
  })
  const invoiceIds = [...new Set(items.map((i: any) => i.invoiceId))]
  const relatedInvoices = invoiceIds.length
    ? await db.query.invoices.findMany({
        where: and(eq(invoices.status, 'emitida'), inArray(invoices.id, invoiceIds)),
        columns: { id: true, storeId: true, issuedAt: true }
      })
    : []
  const invoiceById = new Map(relatedInvoices.map((inv: any) => [inv.id, inv]))

  const events: TimelineEvent[] = []

  for (const m of movements) {
    const qty = Number(m.quantity)
    if (m.type === 'entrada') {
      const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
      events.push({ kind: 'entrada', date, storeId: m.storeId, quantity: qty, unitValue: Number(m.unitValue) })
    }
    if (m.type === 'transferencia_salida') {
      events.push({
        kind: 'salida_transfer', date: m.createdAt, storeId: m.storeId,
        quantity: Math.abs(qty), movementId: m.id, transferId: m.transferId
      })
    }
    if (m.type === 'transferencia_entrada') {
      events.push({
        kind: 'entrada_transfer', date: m.createdAt, storeId: m.storeId,
        quantity: qty, movementId: m.id, transferId: m.transferId
      })
    }
    if (m.type === 'anulacion') {
      const originalType = m.reversesMovementId ? movementTypeById.get(m.reversesMovementId) : undefined
      if (originalType === 'entrada') {
        events.push({ kind: 'anulacion_salida', date: m.createdAt, storeId: m.storeId, quantity: Math.abs(qty) })
      }
    }
    if (m.type === 'ajuste') {
      const date = m.supplierInvoiceDate ? new Date(m.supplierInvoiceDate) : m.createdAt
      if (qty > 0) events.push({ kind: 'entrada', date, storeId: m.storeId, quantity: qty, unitValue: Number(m.unitValue) })
      else if (qty < 0) events.push({ kind: 'ajuste', date, storeId: m.storeId, quantity: Math.abs(qty) })
    }
  }

  for (const item of items) {
    const invoice = invoiceById.get(item.invoiceId)
    if (!invoice) continue
    events.push({ kind: 'venta', date: invoice.issuedAt, storeId: invoice.storeId, quantity: Number(item.quantity) })
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime())
  return events
}

function deplete(layers: Array<{ qty: number; unitCost: number }>, quantity: number) {
  let qtyToConsume = quantity
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

function depleteAndCost(layers: Array<{ qty: number; unitCost: number }>, quantity: number) {
  let qtyToConsume = quantity
  let totalCost = 0
  let coveredQty = 0
  let index = 0
  while (qtyToConsume > EPSILON && index < layers.length) {
    const layer = layers[index]
    if (!layer) break
    const consume = Math.min(layer.qty, qtyToConsume)
    totalCost += consume * layer.unitCost
    coveredQty += consume
    layer.qty -= consume
    qtyToConsume -= consume
    if (layer.qty <= EPSILON) index++
  }
  layers.splice(0, index)
  const cost = coveredQty > EPSILON ? totalCost / coveredQty : 0
  return { cost, coveredQty }
}

async function main() {
  console.log(isApply ? '🔧 Modo APLICAR — se escribirán cambios en la base' : '🔍 Modo DRY-RUN — solo se muestra qué cambiaría (usa --apply para escribir)')

  // Productos candidatos: cualquiera con al menos una transferencia en 0.
  const zeroTransferRows = await db.query.stockMovements.findMany({
    where: and(
      or(eq(stockMovements.type, 'transferencia_salida'), eq(stockMovements.type, 'transferencia_entrada')),
      eq(stockMovements.unitValue, '0.00')
    ),
    columns: { productId: true }
  })
  const productIds = [...new Set(zeroTransferRows.map((r: any) => r.productId))]

  if (!productIds.length) {
    console.log('No se encontraron transferencias con costo 0. Nada que corregir.')
    return
  }
  console.log(`Productos afectados: ${productIds.length}`)

  const allUpdates: PendingUpdate[] = []

  for (const productId of productIds) {
    const events = await buildTimeline(productId)
    const layersByStore = new Map<number, Array<{ qty: number; unitCost: number }>>()
    const costByTransferProduct = new Map<string, number>() // `${transferId}` -> costo

    const getLayers = (storeId: number) => {
      if (!layersByStore.has(storeId)) layersByStore.set(storeId, [])
      return layersByStore.get(storeId)!
    }

    for (const ev of events) {
      const layers = getLayers(ev.storeId)

      if (ev.kind === 'entrada') {
        layers.push({ qty: ev.quantity, unitCost: ev.unitValue ?? 0 })
        continue
      }

      if (ev.kind === 'venta' || ev.kind === 'anulacion_salida' || ev.kind === 'ajuste') {
        deplete(layers, ev.quantity)
        continue
      }

      if (ev.kind === 'salida_transfer') {
        const { cost, coveredQty } = depleteAndCost(layers, ev.quantity)
        if (coveredQty < ev.quantity - EPSILON) {
          console.warn(
            `⚠️  Producto ${productId}, sucursal ${ev.storeId}: faltan capas para cubrir la transferencia (movimiento ${ev.movementId}). ` +
            `Se necesitaban ${ev.quantity}, solo había ${coveredQty.toFixed(3)}. Se usará el costo disponible.`
          )
        }
        if (ev.transferId != null) costByTransferProduct.set(`${ev.transferId}`, cost)

        allUpdates.push({
          movementId: ev.movementId!,
          productId,
          storeId: ev.storeId,
          type: 'transferencia_salida',
          oldUnitValue: 0,
          newUnitValue: Math.round(cost * 100) / 100,
          quantityAbs: ev.quantity
        })
        continue
      }

      if (ev.kind === 'entrada_transfer') {
        const cost = ev.transferId != null ? (costByTransferProduct.get(`${ev.transferId}`) ?? 0) : 0
        layers.push({ qty: ev.quantity, unitCost: cost })

        allUpdates.push({
          movementId: ev.movementId!,
          productId,
          storeId: ev.storeId,
          type: 'transferencia_entrada',
          oldUnitValue: 0,
          newUnitValue: Math.round(cost * 100) / 100,
          quantityAbs: ev.quantity
        })
        continue
      }
    }
  }

  // Solo nos interesa tocar las filas que de verdad estaban en 0 (evita
  // reescribir de más si por alguna razón ya tenían un valor correcto).
  const currentRows = await db.query.stockMovements.findMany({
    where: inArray(stockMovements.id, allUpdates.map((u) => u.movementId)),
    columns: { id: true, unitValue: true }
  })
  const currentById = new Map(currentRows.map((r: any) => [r.id, Number(r.unitValue)]))

  const realUpdates = allUpdates.filter((u) => {
    const current = currentById.get(u.movementId) ?? 0
    return Math.abs(current) <= EPSILON // solo tocar los que siguen en 0
  })

  console.log(`\nMovimientos a corregir: ${realUpdates.length} de ${allUpdates.length} calculados\n`)
  for (const u of realUpdates.slice(0, 50)) {
    console.log(
      `  #${u.movementId} (${u.type}) producto ${u.productId} sucursal ${u.storeId}: ` +
      `0.00 → ${u.newUnitValue.toFixed(2)} (x${u.quantityAbs} = ${(u.newUnitValue * u.quantityAbs).toFixed(2)})`
    )
  }
  if (realUpdates.length > 50) console.log(`  ...y ${realUpdates.length - 50} más`)

  if (!isApply) {
    console.log('\nDry-run completo. Corre con --apply para escribir estos cambios.')
    return
  }

  await db.transaction(async (tx: any) => {
    for (const u of realUpdates) {
      const isOutbound = u.type === 'transferencia_salida'
      const totalValue = isOutbound ? -(u.newUnitValue * u.quantityAbs) : u.newUnitValue * u.quantityAbs
      await tx
        .update(stockMovements)
        .set({ unitValue: String(u.newUnitValue), totalValue: String(Math.round(totalValue * 100) / 100) })
        .where(eq(stockMovements.id, u.movementId))
    }
  })

  console.log(`\n✅ ${realUpdates.length} movimientos corregidos.`)
}

main()
  .then(async () => {
    await client.end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('Error corriendo el script:', err)
    await client.end()
    process.exit(1)
  })