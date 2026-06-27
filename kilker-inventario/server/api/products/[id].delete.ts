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

  const movements = await db.$count(stockMovements, eq(stockMovements.productId, id))
  const saleLines = await db.$count(invoiceItems, eq(invoiceItems.productId, id))
  const transferLines = await db.$count(transferItems, eq(transferItems.productId, id))
  if (movements > 0 || saleLines > 0 || transferLines > 0) {
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
