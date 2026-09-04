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
import {
  entryPayments,
  expensePayments,
  expenses,
  inventory,
  invoices,
  salePayments,
  stockMovements
} from '../db/schema'
import { reversePaymentCashFlowTx } from './cashFlow'

/** Transacción Drizzle (el `tx` que entrega `db.transaction(...)`). */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Anula una factura en transacción: revierte movimientos, repone stock, marca anulada.
 *
 * ⚠️ Los abonos cobrados contra la venta (`sale_payments`) se borran, igual que
 * en `voidMovementTx`: el cobro era de una venta que deja de existir (la
 * mercancía volvió al inventario), así que ese dinero ya no corresponde a esta
 * factura. Se devuelve cuántos se borraron para poder avisarlo en la UI.
 */
export async function voidInvoiceTx(
  tx: Tx,
  opts: { invoiceId: number; profileId: string; reason: string | null }
) {
  // Candado de fila ANTES de leer el estado: en READ COMMITTED dos
  // anulaciones simultáneas de la misma venta (doble clic, o el admin
  // anulando mientras se resuelve el ticket) leen ambas 'emitida' y reponen
  // el stock dos veces. Con FOR UPDATE la segunda espera y ve 'anulada'.
  await tx.execute(sql`SELECT id FROM ${invoices} WHERE id = ${opts.invoiceId} FOR UPDATE`)

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

  // ⚠️ ORDEN: revertir el flujo ANTES de borrar los abonos. Los cobros ya
  // asentados se devuelven con una fila nueva (`anulacion`), no borrando la
  // original — `banks_movements` es append-only igual que el kardex. Y la liga
  // es `ON DELETE SET NULL`: si se borra el abono primero, el movimiento de
  // dinero queda huérfano y ya no hay por dónde encontrarlo para revertirlo, así
  // que el cobro se quedaría sumado a la cuenta para siempre.
  const paymentsToDelete = await tx.query.salePayments.findMany({
    where: eq(salePayments.invoiceId, opts.invoiceId),
    columns: { id: true }
  })

  const cashFlowReversals = await reversePaymentCashFlowTx(tx, {
    source: { salePaymentIds: paymentsToDelete.map((p) => p.id) },
    profileId: opts.profileId,
    reason: opts.reason ?? `Anulación de la venta ${invoice.folio}`
  })

  const deletedPayments = await tx
    .delete(salePayments)
    .where(eq(salePayments.invoiceId, opts.invoiceId))
    .returning({ id: salePayments.id })

  return {
    ...updated!,
    deletedPayments: deletedPayments.length,
    cashFlowReversals: cashFlowReversals.length
  }
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

  // ⚠️ El FOLIO de la entrada, no su id. Este texto viaja a dos rastros que la
  // gente lee sin acceso a la base —`stock_movements.reason` y la nota del
  // movimiento de banco— y ahí un id interno no identifica nada: es correlativo
  // global, mientras que el folio es por tienda, así que ni siquiera coinciden.
  // El `#` del respaldo es para que un id no se confunda con un folio cuando la
  // entrada no trae folio capturado (la columna es nullable).
  const entryLabel = movement.inventoryEntryInvoiceNumber
    ? `la entrada ${movement.inventoryEntryInvoiceNumber}`
    : `la entrada #${movement.id}`
  const defaultReason = `Anulación de ${entryLabel}`

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
    reason: opts.reason || defaultReason,
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

  // Mismo orden que en la venta, y por la misma razón: revertir el flujo antes
  // de borrar los abonos, o el movimiento de dinero queda huérfano.
  const paymentsToDelete = await tx.query.entryPayments.findMany({
    where: eq(entryPayments.movementId, opts.movementId),
    columns: { id: true }
  })

  const cashFlowReversals = await reversePaymentCashFlowTx(tx, {
    source: { entryPaymentIds: paymentsToDelete.map((p) => p.id) },
    profileId: opts.profileId,
    reason: opts.reason || defaultReason
  })

  const deletedPayments = await tx
    .delete(entryPayments)
    .where(eq(entryPayments.movementId, opts.movementId))
    .returning({ id: entryPayments.id })

  return {
    ok: true as const,
    movementId: movement.id,
    deletedPayments: deletedPayments.length,
    cashFlowReversals: cashFlowReversals.length
  }
}

/**
 * Anula un GASTO en transacción: lo marca `anulado` y borra sus pagos.
 *
 * Compartido por `POST /api/expenses/:id/void` (admin directo) y por
 * `POST /api/tickets/:id/resolve` (admin aprobando la solicitud de un
 * empleado), igual que `voidInvoiceTx` y `voidMovementTx`.
 *
 * ⚠️ Un gasto no mueve inventario, así que aquí no hay kardex que revertir: lo
 * único que hay que deshacer es el DINERO. Por eso el borrado de
 * `expense_payments` no es un extra de esta función, es su trabajo principal —
 * un gasto anulado que conservara sus abonos seguiría restando de la cuenta
 * bancaria para siempre.
 *
 * ⚠️ La fila NO se borra, se marca. `expense_items` y `expense_payments` cuelgan
 * con `ON DELETE CASCADE`: un DELETE se llevaría el gasto entero sin dejar
 * rastro de que existió, y el movimiento de banco quedaría sin explicación.
 */
export async function voidExpenseTx(
  tx: Tx,
  opts: { expenseId: number; profileId: string; reason: string | null }
) {
  // Candado de fila ANTES de leer el estado, igual que en las otras dos: sin
  // él, dos anulaciones simultáneas (doble clic, o el admin anulando mientras
  // se resuelve el ticket) leen ambas 'emitido' y revierten el dinero dos veces.
  await tx.execute(sql`SELECT id FROM ${expenses} WHERE id = ${opts.expenseId} FOR UPDATE`)

  const expense = await tx.query.expenses.findFirst({
    where: eq(expenses.id, opts.expenseId)
  })
  if (!expense) throw createError({ statusCode: 404, statusMessage: 'Gasto no existe' })
  if (expense.status === 'anulado') {
    throw createError({ statusCode: 409, statusMessage: 'El gasto ya está anulado' })
  }

  // Mismo orden que en venta y entrada, y por la misma razón: revertir el flujo
  // ANTES de borrar los abonos. `banks_movements.expense_payment_id` es
  // `ON DELETE SET NULL`, así que borrando primero el movimiento de dinero
  // queda huérfano y ese pago se quedaría restado de la cuenta para siempre.
  const paymentsToDelete = await tx.query.expensePayments.findMany({
    where: eq(expensePayments.expenseId, opts.expenseId),
    columns: { id: true }
  })

  const cashFlowReversals = await reversePaymentCashFlowTx(tx, {
    source: { expensePaymentIds: paymentsToDelete.map((p) => p.id) },
    profileId: opts.profileId,
    reason:
      opts.reason ??
      `Anulación del gasto ${expense.supplier} ${expense.supplierInvoiceNumber}`
  })

  const deletedPayments = await tx
    .delete(expensePayments)
    .where(eq(expensePayments.expenseId, opts.expenseId))
    .returning({ id: expensePayments.id })

  const [updated] = await tx
    .update(expenses)
    .set({
      status: 'anulado',
      voidedAt: new Date(),
      voidedBy: opts.profileId,
      voidReason: opts.reason
    })
    .where(eq(expenses.id, opts.expenseId))
    .returning()

  return {
    ...updated!,
    deletedPayments: deletedPayments.length,
    cashFlowReversals: cashFlowReversals.length
  }
}
