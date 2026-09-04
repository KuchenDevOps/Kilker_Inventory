// ───────────────────────────────────────────────
//  DELETE /api/movements/:id/payments/:paymentId — borrar un pago (admin)
// ───────────────────────────────────────────────
// Mismo caso que en ventas: una errata de captura en UN abono no debería
// obligar a anular la entrada (que además saca del inventario la mercancía y
// borra todos sus pagos).
//
// ⚠️ Solo admin. La lógica está en `deleteDocumentPaymentTx`, compartida con los
// otros dos documentos.
import { useDb } from '../../../../db'
import { deleteDocumentPaymentTx } from '../../../../utils/paymentDeletion'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: 'admin' })

  const movementId = Number(getRouterParam(event, 'id'))
  const paymentId = Number(getRouterParam(event, 'paymentId'))
  if (!movementId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })
  if (!paymentId) throw createError({ statusCode: 400, statusMessage: 'ID de pago inválido' })

  const body = await readBody<{ reason?: string }>(event).catch(() => null)

  const db = useDb()
  return await db.transaction((tx) =>
    deleteDocumentPaymentTx(tx, {
      kind: 'entry',
      documentId: movementId,
      paymentId,
      profileId: profile.id,
      reason: body?.reason?.trim() || null
    })
  )
})
