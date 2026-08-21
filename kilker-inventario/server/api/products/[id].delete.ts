// ───────────────────────────────────────────────
//  DELETE /api/products/:id — borrar producto (admin)
// ───────────────────────────────────────────────
// Bloquea 409 si el producto tiene historial (movimientos/ventas/transferencias):
// el kardex es append-only y debe conservar la referencia. En ese caso, desactivar.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { inventory, invoiceItems, products, stockMovements, transferItems } from '../../db/schema'

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const db = useDb()

  const current = await db.query.products.findFirst({ where: eq(products.id, id) })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Producto no existe' })

  // Un producto con muestra no se puede borrar: la muestra quedaría apuntando
  // a un producto inexistente (y la FK lo rechazaría con un error opaco).
  const sample = await db.query.products.findFirst({
    where: eq(products.sampleOfProductId, id)
  })
  if (sample) {
    throw createError({
      statusCode: 409,
      statusMessage: `No se puede borrar: el producto tiene una muestra (${sample.sku}). Bórrala primero o desactiva el producto.`
    })
  }

  const movements = await db.$count(stockMovements, eq(stockMovements.productId, id))
  const saleLines = await db.$count(invoiceItems, eq(invoiceItems.productId, id))
  const transferLines = await db.$count(transferItems, eq(transferItems.productId, id))
  // Las líneas entregadas como muestra guardan el producto BASE en product_id,
  // así que el conteo de arriba no las ve: la muestra solo aparece en
  // sample_product_id. Sin este conteo, borrar una muestra ya entregada
  // rompería el histórico de sus ventas.
  const sampleLines = await db.$count(invoiceItems, eq(invoiceItems.sampleProductId, id))
  if (movements > 0 || saleLines > 0 || transferLines > 0 || sampleLines > 0) {
    throw createError({
      statusCode: 409,
      statusMessage:
        'No se puede borrar: el producto tiene historial (movimientos/ventas). Desactívalo en su lugar.'
    })
  }

  // Sin historial: borra sus filas de inventario (saldo derivado) y el producto.
  await db.transaction(async (tx) => {
    await tx.delete(inventory).where(eq(inventory.productId, id))
    await tx.delete(products).where(eq(products.id, id))
  })

  return { ok: true, id }
})
