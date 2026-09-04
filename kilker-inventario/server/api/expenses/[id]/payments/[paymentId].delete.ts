// ───────────────────────────────────────────────
//  DELETE /api/expenses/:id/payments/:paymentId — borrar un pago (admin)
// ───────────────────────────────────────────────
// El caso más frecuente de los tres: el gasto se congela en cuanto entra el
// primer abono (`PATCH /api/expenses/:id` → 409), así que una errata en el pago
// dejaba como única salida anular el gasto — y anularlo BORRA todos los demás
// abonos, con sus fechas, métodos, cuentas y pagadores.
//
// ⚠️ Solo admin. La lógica está en `deleteDocumentPaymentTx`, compartida con
// ventas y entradas.
import { useDb } from '../../../../db'
import { deleteDocumentPaymentTx } from '../../../../utils/paymentDeletion'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: 'admin' })

  const expenseId = Number(getRouterParam(event, 'id'))
  const paymentId = Number(getRouterParam(event, 'paymentId'))
  if (!expenseId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })
  if (!paymentId) throw createError({ statusCode: 400, statusMessage: 'ID de pago inválido' })

  const body = await readBody<{ reason?: string }>(event).catch(() => null)

  const db = useDb()
  return await db.transaction((tx) =>
    deleteDocumentPaymentTx(tx, {
      kind: 'expense',
      documentId: expenseId,
      paymentId,
      profileId: profile.id,
      reason: body?.reason?.trim() || null
    })
  )
})
