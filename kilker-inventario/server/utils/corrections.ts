// ───────────────────────────────────────────────
//  CORRECCIONES DE INVENTARIO (transaccional)
// ───────────────────────────────────────────────
// Compartido por sales/:id/void, movements/:id/void y tickets/:id/resolve;
// una sola implementación por tipo de documento.
//
// El kardex (`stock_movements`) es APPEND-ONLY: hay un trigger en la migración
// 0001 que rechaza UPDATE y DELETE. Por eso corregir NUNCA es editar la fila
// original, sino insertar una fila `anulacion` con signo opuesto ligada por
// `reverses_movement_id`, y mover `inventory` en la misma transacción.
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { entryPayments, inventory, invoices, stockMovements } from '../db/schema'

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

/**
 * Anula una ENTRADA de stock en transacción: descuenta del inventario lo que
 * la entrada había sumado y registra la reversa en el kardex.
 *
 * Compartido por `POST /api/movements/:id/void` (admin directo) y por
 * `POST /api/tickets/:id/resolve` (admin aprobando la solicitud de un
 * empleado), igual que `voidInvoiceTx` lo está para las ventas.
 *
 * ⚠️ Dos límites inherentes, no bugs:
 *   1. Si parte del stock de esa entrada ya se vendió o transfirió, no hay
 *      qué descontar y la anulación se rechaza (400). Primero hay que
 *      revertir las salidas.
 *   2. Los abonos registrados contra la entrada (`entry_payments`) se
 *      borran: el pago era de una entrada que deja de existir. Se devuelve
 *      cuántos se borraron para poder avisarlo en la UI.
 */
export async function voidMovementTx(
  tx: Tx,
  opts: { movementId: number; profileId: string; reason: string | null }
) {
  // Candado de fila ANTES de leer el estado: sin esto, dos anulaciones
  // simultáneas (o un doble clic) pasan ambas la comprobación de "¿ya está
  // anulada?" y descuentan el inventario dos veces.
  await tx.execute(
    sql`SELECT id FROM ${stockMovements} WHERE id = ${opts.movementId} FOR UPDATE`
  )

  const movement = await tx.query.stockMovements.findFirst({
    where: eq(stockMovements.id, opts.movementId)
  })
  if (!movement) {
    throw createError({ statusCode: 404, statusMessage: 'Movimiento no existe' })
  }
  if (movement.type !== 'entrada') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Solo se pueden anular movimientos de tipo "entrada"'
    })
  }

  const existingReversal = await tx.query.stockMovements.findFirst({
    where: eq(stockMovements.reversesMovementId, opts.movementId)
  })
  if (existingReversal) {
    throw createError({ statusCode: 409, statusMessage: 'Esta entrada ya fue anulada' })
  }

  const quantity = Number(movement.quantity) // positivo: es una entrada

  const inv = await tx.query.inventory.findFirst({
    where: and(
      eq(inventory.productId, movement.productId),
      eq(inventory.storeId, movement.storeId)
    )
  })
  const available = inv ? Number(inv.quantity) : 0
  if (available < quantity) {
    throw createError({
      statusCode: 400,
      statusMessage:
        `No se puede anular: solo hay ${available} disponible(s), pero la entrada fue de ${quantity}. ` +
        'Es probable que parte de este stock ya se haya vendido o transferido.'
    })
  }

  await tx.insert(stockMovements).values({
    productId: movement.productId,
    storeId: movement.storeId,
    type: 'anulacion',
    quantity: String(-quantity),
    unitValue: movement.unitValue,
    totalValue: String(-Number(movement.totalValue)),
    reversesMovementId: movement.id,
    reason: opts.reason || 'Anulación de entrada',
    createdBy: opts.profileId
  })

  await tx
    .update(inventory)
    .set({ quantity: sql`${inventory.quantity} - ${quantity}`, updatedAt: new Date() })
    .where(
      and(
        eq(inventory.productId, movement.productId),
        eq(inventory.storeId, movement.storeId)
      )
    )

  const deletedPayments = await tx
    .delete(entryPayments)
    .where(eq(entryPayments.movementId, opts.movementId))
    .returning({ id: entryPayments.id })

  return { ok: true as const, movementId: movement.id, deletedPayments: deletedPayments.length }
}
