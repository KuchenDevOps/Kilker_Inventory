// POST /api/tickets — abrir un ticket de corrección (empleado o admin).
// v1: solo correcciones de tipo `factura` (solicitud de anulación de una venta).
// El empleado solo puede levantar tickets de SU tienda; el admin, de cualquiera.
// Crea el ticket en estado `abierto`; el admin lo resuelve en /tickets/:id/resolve.
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoices, tickets } from '../../db/schema'

interface NewTicketBody {
  invoiceId?: number
  reason?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const body = await readBody<NewTicketBody>(event)

  const invoiceId = Number(body?.invoiceId)
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!invoiceId) {
    throw createError({ statusCode: 400, statusMessage: 'invoiceId es requerido' })
  }
  if (!reason) {
    throw createError({ statusCode: 400, statusMessage: 'El motivo es obligatorio' })
  }

  const db = useDb()

  const invoice = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) })
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Venta no existe' })

  // El empleado solo levanta tickets de su tienda.
  if (profile.role === 'empleado' && profile.storeId !== invoice.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Solo puedes solicitar correcciones de tu sucursal'
    })
  }
  if (invoice.status === 'anulada') {
    throw createError({ statusCode: 409, statusMessage: 'La venta ya está anulada' })
  }

  // Evitar tickets duplicados abiertos para la misma factura.
  const open = await db.query.tickets.findFirst({
    where: and(
      eq(tickets.invoiceId, invoiceId),
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
