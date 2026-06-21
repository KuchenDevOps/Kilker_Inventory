// Lógica transaccional de correcciones de inventario, compartida por:
//   - POST /api/sales/:id/void        (anulación directa por admin)
//   - POST /api/tickets/:id/resolve   (anulación aprobada desde un ticket)
//
// Mantener UNA sola implementación evita que las dos rutas se desincronicen.
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { inventory, invoices, stockMovements } from '../db/schema'

/** Transacción Drizzle (el `tx` que entrega `db.transaction(...)`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Anula una factura DENTRO de una transacción: por cada movimiento `venta`
 * inserta un movimiento `anulacion` que lo revierte (signo opuesto,
 * `reversesMovementId` → original), repone `inventory` y marca la factura como
 * `anulada`. El kardex es append-only: el movimiento original NUNCA se toca.
 * Lanza 404 si la factura no existe y 409 si ya está anulada o no tiene ventas.
 */
export async function voidInvoiceTx(
  tx: Tx,
  opts: { invoiceId: number; profileId: string; reason: string | null }
) {
  const invoice = await tx.query.invoices.findFirst({
    where: eq(invoices.id, opts.invoiceId)
  })
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Venta no existe' })
  if (invoice.status === 'anulada') {
    throw createError({ statusCode: 409, statusMessage: 'La venta ya está anulada' })
  }

  const ventas = await tx.query.stockMovements.findMany({
    where: and(
      eq(stockMovements.invoiceId, opts.invoiceId),
      eq(stockMovements.type, 'venta')
    )
  })
  if (ventas.length === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'La venta no tiene movimientos que revertir'
    })
  }

  for (const m of ventas) {
    // La venta guardó cantidad/importe NEGATIVOS; la reversa lleva el signo opuesto.
    const reverseQty = -Number(m.quantity) // positivo: repone stock
    const reverseTotal = -Number(m.totalValue) // positivo

    await tx.insert(stockMovements).values({
      productId: m.productId,
      storeId: m.storeId,
      type: 'anulacion',
      quantity: String(reverseQty),
      unitValue: m.unitValue,
      totalValue: String(reverseTotal),
      invoiceId: opts.invoiceId,
      reversesMovementId: m.id,
      reason: opts.reason,
      createdBy: opts.profileId
    })

    await tx
      .insert(inventory)
      .values({ productId: m.productId, storeId: m.storeId, quantity: String(reverseQty) })
      .onConflictDoUpdate({
        target: [inventory.productId, inventory.storeId],
        set: {
          quantity: sql`${inventory.quantity} + ${reverseQty}`,
          updatedAt: new Date()
        }
      })
  }

  const [updated] = await tx
    .update(invoices)
    .set({
      status: 'anulada',
      voidedAt: new Date(),
      voidedBy: opts.profileId,
      voidReason: opts.reason
    })
    .where(eq(invoices.id, opts.invoiceId))
    .returning()

  return updated
}
