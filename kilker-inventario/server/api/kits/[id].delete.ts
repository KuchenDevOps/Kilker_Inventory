// ───────────────────────────────────────────────
//  DELETE /api/kits/:id — borrar kit de venta (admin)
// ───────────────────────────────────────────────

import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoiceItems, salesKits } from '../../db/schema'

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'id de kit inválido' })
  }

  const db = useDb()

  const current = await db.query.salesKits.findFirst({ where: eq(salesKits.id, id) })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Kit no existe' })

  const saleLines = await db.$count(invoiceItems, eq(invoiceItems.kitId, id))
  if (saleLines > 0) {
    throw createError({
      statusCode: 409,
      statusMessage:
        'No se puede borrar: el kit ya se vendió y sus tickets lo referencian. Desactívalo en su lugar.'
    })
  }

  await db.delete(salesKits).where(eq(salesKits.id, id))

  return { ok: true, id }
})
