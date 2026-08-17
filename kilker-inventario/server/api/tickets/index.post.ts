// ───────────────────────────────────────────────
//  POST /api/tickets — abrir ticket de corrección
// ───────────────────────────────────────────────
// Dos objetivos posibles, uno por ticket:
//   · target 'factura'    → `invoiceId`  (venta a anular)
//   · target 'movimiento' → `movementId` (entrada de stock a anular)
//
// El empleado no anula nada por su cuenta: abre el ticket y un admin lo
// resuelve en /tickets. Es la única vía de corrección para el empleado, y para
// las entradas sustituye al antiguo `PATCH /api/movements/:id`, que editaba la
// fila del kardex en sitio y chocaba con el trigger append-only de la 0001.
import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices, stockMovements, tickets } from '../../db/schema'

interface NewTicketBody {
  invoiceId?: number
  movementId?: number
  reason?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const body = await readBody<NewTicketBody>(event)

  // `|| null` descarta también el 0, que nunca es un id válido.
  const invoiceId = Number(body?.invoiceId) || null
  const movementId = Number(body?.movementId) || null

  if ((invoiceId == null) === (movementId == null)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Manda exactamente uno: invoiceId (venta) o movementId (entrada)'
    })
  }

  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: 'El motivo es obligatorio' })
  }

  const db = useDb()

  // ─── Objetivo: entrada de stock ───
  if (movementId != null) {
    const movement = await db.query.stockMovements.findFirst({
      where: eq(stockMovements.id, movementId)
    })
    if (!movement) {
      throw createError({ statusCode: 404, statusMessage: 'La entrada no existe' })
    }
    if (movement.type !== 'entrada') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Solo se pueden corregir movimientos de tipo "entrada"'
      })
    }

    if (profile.role === 'empleado' && profile.storeId !== movement.storeId) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Solo puedes solicitar correcciones de tu sucursal'
      })
    }

    // Ya anulada: no hay nada que corregir.
    const reversal = await db.query.stockMovements.findFirst({
      where: eq(stockMovements.reversesMovementId, movementId)
    })
    if (reversal) {
      throw createError({ statusCode: 409, statusMessage: 'Esta entrada ya fue anulada' })
    }

    const open = await db.query.tickets.findFirst({
      where: and(eq(tickets.movementId, movementId), eq(tickets.status, 'abierto'))
    })
    if (open) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Ya hay un ticket abierto para esta entrada'
      })
    }

    const [created] = await db
      .insert(tickets)
      .values({
        raisedBy: profile.id,
        storeId: movement.storeId,
        target: 'movimiento',
        movementId,
        reason,
        status: 'abierto'
      })
      .returning()

    return created
  }

  // ─── Objetivo: venta ───
  // Aquí invoiceId ya no puede ser null: la guarda de arriba exige exactamente
  // uno de los dos, y la rama de movimiento hizo return.
  if (invoiceId == null) {
    throw createError({ statusCode: 400, statusMessage: 'invoiceId es requerido' })
  }

  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Venta no existe' })

  // Empleado solo abre tickets de su tienda.
  if (profile.role === 'empleado' && profile.storeId !== invoice.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Solo puedes solicitar correcciones de tu sucursal'
    })
  }
  if (invoice.status === 'anulada') {
    throw createError({ statusCode: 409, statusMessage: 'La venta ya está anulada' })
  }

  // Evitar tickets duplicados abiertos para la misma factura. `isNull(movementId)`
  // acota a los tickets de venta: sin eso, el índice de la consulta abarcaría
  // también los de entrada si algún día comparten invoiceId nulo.
  const open = await db.query.tickets.findFirst({
    where: and(
      eq(tickets.invoiceId, invoiceId),
      isNull(tickets.movementId),
      eq(tickets.status, 'abierto')
    )
  })
  if (open) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ya hay un ticket abierto para esta venta'
    })
  }

  const [created] = await db
    .insert(tickets)
    .values({
      raisedBy: profile.id,
      storeId: invoice.storeId,
      target: 'factura',
      invoiceId,
      reason,
      status: 'abierto'
    })
    .returning()

  return created
})
