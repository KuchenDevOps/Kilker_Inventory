// ───────────────────────────────────────────────
//  POST /api/tickets/:id/resolve — resolver (admin)
// ───────────────────────────────────────────────
// aprobar: anula la factura + marca aprobado en transacción. rechazar: solo cierra.
import { eq } from 'drizzle-orm'
import { useDb } from '../../../db'
import { tickets } from '../../../db/schema'

interface ResolveBody {
  action?: 'aprobar' | 'rechazar'
  note?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const body = await readBody<ResolveBody>(event)
  const action = body?.action
  if (action !== 'aprobar' && action !== 'rechazar') {
    throw createError({
      statusCode: 400,
      statusMessage: "action debe ser 'aprobar' o 'rechazar'"
    })
  }
  const note = typeof body?.note === 'string' ? body.note.trim() || null : null

  const db = useDb()

  const ticket = await db.query.tickets.findFirst({ where: eq(tickets.id, id) })
  if (!ticket) throw createError({ statusCode: 404, statusMessage: 'Ticket no existe' })
  if (ticket.status !== 'abierto') {
    throw createError({ statusCode: 409, statusMessage: 'El ticket ya fue resuelto' })
  }

  // Rechazo: no toca inventario, solo cierra el ticket.
  if (action === 'rechazar') {
    const [updated] = await db
      .update(tickets)
      .set({
        status: 'rechazado',
        resolvedBy: profile.id,
        resolvedAt: new Date(),
        resolutionNote: note
      })
      .where(eq(tickets.id, id))
      .returning()
    return updated
  }

  // Aprobación: ejecutar la corrección. v1 solo target factura.
  if (ticket.target !== 'factura' || ticket.invoiceId == null) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Solo se pueden aprobar tickets de tipo factura (v1)'
    })
  }

  return await db.transaction(async (tx) => {
    await voidInvoiceTx(tx, {
      invoiceId: ticket.invoiceId!,
      profileId: profile.id,
      reason: note ?? ticket.reason
    })
    const [updated] = await tx
      .update(tickets)
      .set({
        status: 'aprobado',
        resolvedBy: profile.id,
        resolvedAt: new Date(),
        resolutionNote: note
      })
      .where(eq(tickets.id, id))
      .returning()
    return updated
  })
})
