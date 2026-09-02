// ───────────────────────────────────────────────
//  POST /api/tickets/:id/resolve — resolver (admin)
// ───────────────────────────────────────────────
// aprobar: anula el documento (venta, entrada o gasto) + marca aprobado, todo
// en una transacción. rechazar: solo cierra el ticket, no toca nada.
import { eq, sql } from 'drizzle-orm'
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

  // Todo dentro de la transacción, incluida la lectura del ticket: leerlo
  // fuera dejaba una ventana en la que dos admins resolvían el mismo ticket a
  // la vez y la corrección se aplicaba dos veces.
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${tickets} WHERE id = ${id} FOR UPDATE`)

    const ticket = await tx.query.tickets.findFirst({ where: eq(tickets.id, id) })
    if (!ticket) throw createError({ statusCode: 404, statusMessage: 'Ticket no existe' })
    if (ticket.status !== 'abierto') {
      throw createError({ statusCode: 409, statusMessage: 'El ticket ya fue resuelto' })
    }

    // Aprobación: ejecutar la corrección que corresponda al objetivo. El
    // rechazo no toca inventario, solo cierra el ticket.
    if (action === 'aprobar') {
      const reason = note ?? ticket.reason

      if (ticket.target === 'factura') {
        if (ticket.invoiceId == null) {
          throw createError({
            statusCode: 400,
            statusMessage: 'El ticket no tiene venta asociada'
          })
        }
        await voidInvoiceTx(tx, {
          invoiceId: ticket.invoiceId,
          profileId: profile.id,
          reason
        })
      } else if (ticket.target === 'gasto') {
        if (ticket.expenseId == null) {
          throw createError({
            statusCode: 400,
            statusMessage: 'El ticket no tiene gasto asociado'
          })
        }
        await voidExpenseTx(tx, {
          expenseId: ticket.expenseId,
          profileId: profile.id,
          reason
        })
      } else {
        if (ticket.movementId == null) {
          throw createError({
            statusCode: 400,
            statusMessage: 'El ticket no tiene entrada asociada'
          })
        }
        await voidMovementTx(tx, {
          movementId: ticket.movementId,
          profileId: profile.id,
          reason
        })
      }
    }

    const [updated] = await tx
      .update(tickets)
      .set({
        status: action === 'aprobar' ? 'aprobado' : 'rechazado',
        resolvedBy: profile.id,
        resolvedAt: new Date(),
        resolutionNote: note
      })
      .where(eq(tickets.id, id))
      .returning()

    return updated
  })
})
