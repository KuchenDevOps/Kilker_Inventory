// ───────────────────────────────────────────────
//  POST /api/sales/:id/void — anular venta (admin)
// ───────────────────────────────────────────────
// Delega en voidInvoiceTx (compartido con tickets). Kardex append-only.
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
    voidInvoiceTx(tx, { invoiceId: id, profileId: profile.id, reason })
  )
})
