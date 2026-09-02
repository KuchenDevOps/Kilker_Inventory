// ───────────────────────────────────────────────
//  POST /api/expenses/:id/void — anular gasto (admin)
// ───────────────────────────────────────────────
// Delega en voidExpenseTx (compartido con tickets), igual que
// /api/sales/:id/void y /api/movements/:id/void. Anular BORRA los pagos del
// gasto y revierte su movimiento de banco.
import { useDb } from '../../../db'

interface VoidBody {
  reason?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const body = await readBody<VoidBody>(event).catch(() => ({}) as VoidBody)
  const reason = typeof body?.reason === 'string' ? body.reason.trim() || null : null

  const db = useDb()
  return await db.transaction((tx) =>
    voidExpenseTx(tx, { expenseId: id, profileId: profile.id, reason })
  )
})
