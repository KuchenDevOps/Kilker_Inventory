// ───────────────────────────────────────────────
//  PATCH /api/expenses/:id/payments — asignar cuenta a todos los pagos (admin)
// ───────────────────────────────────────────────
// Corrección masiva por documento: pone la misma cuenta en todos sus pagos
// bancarios de una sola vez, en vez de borrar y recapturar abono por abono.
//
// ⚠️ Solo admin. No es captura, es reescribir a qué cuenta se atribuyó dinero ya
// registrado — misma categoría que anular una venta, no que registrar un pago.
//
// ⚠️ Los pagos en EFECTIVO se saltan siempre; la regla y el porqué están en
// `assignAccountToDocumentPayments` (server/utils/bankAccounts.ts).
import { eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { expenses } from '../../../../db/schema'
import { assignAccountToDocumentPayments } from '../../../../utils/bankAccounts'

interface Body {
  /** null deja los pagos sin cuenta (o sea, como efectivo). */
  accountId?: number | string | null
}

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const body = await readBody<Body>(event)
  const accountId = body?.accountId == null ? null : Number(body.accountId)
  if (accountId != null && !accountId) {
    throw createError({ statusCode: 400, statusMessage: 'accountId inválido' })
  }

  const db = useDb()

  const doc = await db.query.expenses.findFirst({
    where: eq(expenses.id, id),
    columns: { id: true }
  })
  if (!doc) throw createError({ statusCode: 404, statusMessage: 'Gasto no existe' })

  return await assignAccountToDocumentPayments(db, {
    kind: 'expense',
    documentId: id,
    accountId
  })
})
