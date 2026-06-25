// ───────────────────────────────────────────────
//  CORRECCIONES DE INVENTARIO (transaccional)
// ───────────────────────────────────────────────
// Compartido por sales/:id/void y tickets/:id/resolve; una sola implementación.
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { inventory, invoices, stockMovements } from '../db/schema'

/** Transacción Drizzle (el `tx` que entrega `db.transaction(...)`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Anula una factura en transacción: revierte movimientos, repone stock, marca anulada. */
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
    // La venta es negativa; la reversa lleva el signo opuesto (repone stock).
    const reverseQty = -Number(m.quantity)
    const reverseTotal = -Number(m.totalValue)

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
