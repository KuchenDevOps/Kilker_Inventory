// ───────────────────────────────────────────────
//  DELETE /api/sales/:id/payments/:paymentId — borrar un cobro (admin)
// ───────────────────────────────────────────────
// Para cuando el cobro se capturó mal (monto, fecha, método o cuenta). Antes la
// única salida era anular la venta entera —reponiendo el inventario y borrando
// TODOS sus abonos— por una errata en uno.
//
// ⚠️ Solo admin, igual que el PATCH de asignación de cuenta: no es captura, es
// deshacer dinero ya asentado. El trabajo real (candado, reversa del flujo,
// borrado) vive en `deleteDocumentPaymentTx`.
import { useDb } from '../../../../db'
import { deleteDocumentPaymentTx } from '../../../../utils/paymentDeletion'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: 'admin' })

  const invoiceId = Number(getRouterParam(event, 'id'))
  const paymentId = Number(getRouterParam(event, 'paymentId'))
  if (!invoiceId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })
  if (!paymentId) throw createError({ statusCode: 400, statusMessage: 'ID de pago inválido' })

  // El motivo es opcional y el DELETE puede venir sin cuerpo; readBody revienta
  // al parsear vacío, así que se tolera.
  const body = await readBody<{ reason?: string }>(event).catch(() => null)

  const db = useDb()
  return await db.transaction((tx) =>
    deleteDocumentPaymentTx(tx, {
      kind: 'sale',
      documentId: invoiceId,
      paymentId,
      profileId: profile.id,
      reason: body?.reason?.trim() || null
    })
  )
})
