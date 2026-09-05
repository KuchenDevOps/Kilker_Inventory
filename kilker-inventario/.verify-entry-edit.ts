import 'dotenv/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import * as schema from './server/db/schema'
import { getEntriesRemainingUnits } from './server/utils/inventoryFifo'

const client = postgres(process.env.DIRECT_URL!, { prepare: false, max: 1 })
const db = drizzle(client, { schema })

const results: string[] = []
function ok(name: string, pass: boolean, extra = '') {
  results.push(`${pass ? 'OK  ' : 'FALLA'} · ${name}${extra ? ' → ' + extra : ''}`)
}
async function expectFail(name: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    ok(name, false, 'no lanzó error')
  } catch (e) {
    ok(name, true, String((e as Error).message).slice(0, 90))
  }
}

class Rollback extends Error {}

async function main() {
try {
  await db.transaction(async (tx) => {
    const [store] = await tx.execute(sql`SELECT id, code FROM stores ORDER BY id LIMIT 1`) as unknown as { id: number; code: string }[]
    const [product] = await tx.execute(sql`SELECT id, sku FROM products WHERE sample_of_product_id IS NULL ORDER BY id LIMIT 1`) as unknown as { id: number; sku: string }[]
    const [profile] = await tx.execute(sql`SELECT id FROM profiles ORDER BY created_at LIMIT 1`) as unknown as { id: string }[]
    if (!store || !product || !profile) throw new Error('faltan datos base')

    const [entry] = await tx.execute(sql`
      INSERT INTO stock_movements
        (product_id, store_id, type, quantity, unit_value, total_value, "Folio",
         supplier_invoice_number, supplier_invoice_date, created_by)
      VALUES (${product.id}, ${store.id}, 'entrada', 10, 100, 1000, ${'TEST-E-' + Date.now()},
              'F-VIEJA', '2026-09-01', ${profile.id})
      RETURNING id
    `) as unknown as { id: number }[]
    const entryId = entry!.id

    await tx.execute(sql`
      INSERT INTO inventory (product_id, store_id, quantity)
      VALUES (${product.id}, ${store.id}, 10)
      ON CONFLICT (product_id, store_id) DO UPDATE SET quantity = inventory.quantity + 10
    `)

    const intactBefore = await getEntriesRemainingUnits(tx as never, [
      { id: entryId, productId: product.id, storeId: store.id }
    ])
    ok('capa íntegra al crear la entrada', (intactBefore.get(entryId) ?? 0) >= 10,
      `${intactBefore.get(entryId) ?? 0} de 10 unidades vivas`)

    await tx.execute(sql`
      UPDATE stock_movements
      SET unit_value = 110, total_value = 1100,
          supplier_invoice_number = 'F-REAL-778', supplier_invoice_date = '2026-09-04'
      WHERE id = ${entryId}
    `)
    const [after] = await tx.execute(sql`
      SELECT unit_value, total_value, supplier_invoice_number, supplier_invoice_date
      FROM stock_movements WHERE id = ${entryId}
    `) as unknown as { unit_value: string; total_value: string; supplier_invoice_number: string; supplier_invoice_date: string }[]
    ok('corregir costo + factura + fecha', Number(after!.total_value) === 1100 && after!.supplier_invoice_number === 'F-REAL-778',
      `${after!.unit_value} × 10 = ${after!.total_value}, ${after!.supplier_invoice_number}, ${after!.supplier_invoice_date}`)

    await expectFail('cambiar cantidad rechazado', () =>
      tx.execute(sql`UPDATE stock_movements SET quantity = 99 WHERE id = ${entryId}`))
    await expectFail('cambiar sucursal rechazado', () =>
      tx.execute(sql`UPDATE stock_movements SET store_id = ${store.id + 1} WHERE id = ${entryId}`))
    await expectFail('cambiar folio rechazado', () =>
      tx.execute(sql`UPDATE stock_movements SET "Folio" = 'OTRO' WHERE id = ${entryId}`))
    await expectFail('total_value incoherente rechazado', () =>
      tx.execute(sql`UPDATE stock_movements SET unit_value = 50, total_value = 999 WHERE id = ${entryId}`))
    await expectFail('DELETE sigue prohibido', () =>
      tx.execute(sql`DELETE FROM stock_movements WHERE id = ${entryId}`))

    const [saleMovement] = await tx.execute(sql`
      SELECT id FROM stock_movements WHERE type <> 'entrada' ORDER BY id DESC LIMIT 1
    `) as unknown as { id: number }[]
    if (saleMovement) {
      await expectFail('UPDATE en un movimiento que no es entrada rechazado', () =>
        tx.execute(sql`UPDATE stock_movements SET unit_value = unit_value WHERE id = ${saleMovement.id}`))
    }

    const [invoice] = await tx.execute(sql`
      INSERT INTO invoices (folio, store_id, customer_id, total_amount, payment_method, status, issued_at, created_by)
      VALUES (${'TEST-V-' + Date.now()}, ${store.id}, NULL, 300, 'efectivo', 'emitida', now(), ${profile.id})
      RETURNING id
    `) as unknown as { id: number }[]
    await tx.execute(sql`
      INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, line_total)
      VALUES (${invoice!.id}, ${product.id}, 3, 100, 300)
    `)

    const intactAfterSale = await getEntriesRemainingUnits(tx as never, [
      { id: entryId, productId: product.id, storeId: store.id }
    ])
    const remaining = intactAfterSale.get(entryId) ?? 0
    ok('tras vender 3, la capa deja de estar íntegra', remaining < 10,
      `${remaining} de 10 unidades vivas`)

    throw new Rollback()
  })
} catch (e) {
  if (!(e instanceof Rollback)) {
    console.error('ERROR:', e)
    results.push('FALLA · la transacción reventó antes de terminar')
  }
}

console.log('\n' + results.join('\n') + '\n')

const [count] = await client`SELECT count(*)::int AS n FROM stock_movement_edits`
const [leftovers] = await client`SELECT count(*)::int AS n FROM stock_movements WHERE "Folio" LIKE 'TEST-E-%'`
const [leftoverInvoices] = await client`SELECT count(*)::int AS n FROM invoices WHERE folio LIKE 'TEST-V-%'`
console.log(`bitácora stock_movement_edits: ${count!.n} fila(s)`)
console.log(`residuo de prueba en stock_movements: ${leftovers!.n} · en invoices: ${leftoverInvoices!.n}`)

await client.end()
}

main()
