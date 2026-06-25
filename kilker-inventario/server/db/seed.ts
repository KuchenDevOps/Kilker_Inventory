// ───────────────────────────────────────────────
//  SEED DEL CATÁLOGO (solo desarrollo)
// ───────────────────────────────────────────────
// Resetea e inserta tiendas/categorías/productos/inventario. No siembra usuarios.
// Ejecutar: npm run db:seed (DIRECT_URL). No correr sobre datos reales.

import 'dotenv/config'
import process from 'node:process'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { categories, inventory, products, stores } from './schema'

const url = process.env.DIRECT_URL
if (!url) {
  throw new Error(
    'Falta DIRECT_URL en .env (session pooler 5432). Necesaria para el seed.'
  )
}

type Unit = 'litro' | 'galon' | 'cubeta'

const storeSeed: { name: string; code: string }[] = [
  { name: 'Matriz Centro', code: 'MTZ' },
  { name: 'Sucursal Norte', code: 'NTE' },
  { name: 'Sucursal Sur', code: 'SUR' }
]

const categorySeed: string[] = ['Esmaltes', 'Vinílicas', 'Selladores', 'Solventes']

const productSeed: {
  sku: string
  name: string
  category: string
  color: string | null
  unit: Unit
  price: string
  cost: string
  minQuantity: string
  isActive: boolean
}[] = [
  { sku: 'ESM-BLA-1L', name: 'Esmalte sintético blanco brillante 1 L', category: 'Esmaltes', color: 'Blanco', unit: 'litro', price: '280', cost: '180', minQuantity: '10', isActive: true },
  { sku: 'VIN-BLA-19L', name: 'Pintura vinílica blanca mate 19 L', category: 'Vinílicas', color: 'Blanco', unit: 'cubeta', price: '1850', cost: '1200', minQuantity: '5', isActive: true },
  { sku: 'VIN-AZU-4L', name: 'Pintura vinílica azul cielo satinada 4 L', category: 'Vinílicas', color: 'Azul cielo', unit: 'galon', price: '620', cost: '400', minQuantity: '8', isActive: true },
  { sku: 'SEL-4L', name: 'Sellador 5x1 vinílico 4 L', category: 'Selladores', color: 'Blanco', unit: 'galon', price: '540', cost: '350', minQuantity: '4', isActive: true },
  { sku: 'THI-1L', name: 'Thinner estándar 1 L', category: 'Solventes', color: null, unit: 'litro', price: '95', cost: '60', minQuantity: '20', isActive: false }
]

// Existencias por (producto, tienda); algunas bajo el mínimo a propósito.
const inventorySeed: { sku: string; store: string; quantity: string }[] = [
  { sku: 'ESM-BLA-1L', store: 'MTZ', quantity: '4' },
  { sku: 'ESM-BLA-1L', store: 'NTE', quantity: '3' },
  { sku: 'VIN-BLA-19L', store: 'MTZ', quantity: '12' },
  { sku: 'VIN-BLA-19L', store: 'SUR', quantity: '6' },
  { sku: 'VIN-AZU-4L', store: 'MTZ', quantity: '9' },
  { sku: 'VIN-AZU-4L', store: 'NTE', quantity: '5' },
  { sku: 'SEL-4L', store: 'SUR', quantity: '2' },
  { sku: 'THI-1L', store: 'MTZ', quantity: '30' }
]

const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema })

async function main() {
  await db.transaction(async (tx) => {
    // Reset en orden seguro de FKs.
    await tx.delete(inventory)
    await tx.delete(products)
    await tx.delete(categories)
    await tx.delete(stores)

    const insertedStores = await tx
      .insert(stores)
      .values(storeSeed)
      .returning({ id: stores.id, code: stores.code })
    const storeId = new Map(insertedStores.map((s) => [s.code, s.id]))

    const insertedCategories = await tx
      .insert(categories)
      .values(categorySeed.map((name) => ({ name })))
      .returning({ id: categories.id, name: categories.name })
    const categoryId = new Map(insertedCategories.map((c) => [c.name, c.id]))

    const insertedProducts = await tx
      .insert(products)
      .values(
        productSeed.map((p) => ({
          sku: p.sku,
          name: p.name,
          categoryId: categoryId.get(p.category) ?? null,
          color: p.color,
          unit: p.unit,
          price: p.price,
          cost: p.cost,
          minQuantity: p.minQuantity,
          isActive: p.isActive
        }))
      )
      .returning({ id: products.id, sku: products.sku })
    const productId = new Map(insertedProducts.map((p) => [p.sku, p.id]))

    await tx.insert(inventory).values(
      inventorySeed.map((i) => {
        const pid = productId.get(i.sku)
        const sid = storeId.get(i.store)
        if (pid == null || sid == null) {
          throw new Error(`Inventario: SKU/tienda no encontrada (${i.sku} @ ${i.store})`)
        }
        return { productId: pid, storeId: sid, quantity: i.quantity }
      })
    )
  })

  console.log(
    `Seed OK: ${storeSeed.length} tiendas, ${categorySeed.length} categorías, ` +
      `${productSeed.length} productos, ${inventorySeed.length} filas de inventario.`
  )
}

main()
  .then(async () => {
    await client.end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('Seed FALLÓ:', err)
    await client.end()
    process.exit(1)
  })
