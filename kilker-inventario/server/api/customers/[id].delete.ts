// ───────────────────────────────────────────────
//  DELETE /api/customers/:id — desactiva un cliente (borrado suave)
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { customers } from '../../db/schema'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'ID inválido' })
  }

  const db = useDb()
  const [updated] = await db
    .update(customers)
    .set({ isActive: false })
    .where(eq(customers.id, id))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: 'Cliente no existe' })
  }
  return updated
})