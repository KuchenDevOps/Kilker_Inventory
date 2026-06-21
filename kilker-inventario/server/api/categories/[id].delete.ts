// DELETE /api/categories/:id — eliminar una categoría (solo admin).
// Bloquea si tiene productos asociados o subcategorías (devuelve 409 claro),
// para no romper las FKs ni dejar productos huérfanos sin querer.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { categories, products } from '../../db/schema'

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const db = useDb()

  const current = await db.query.categories.findFirst({
    where: eq(categories.id, id)
  })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Categoría no existe' })

  const productCount = await db.$count(products, eq(products.categoryId, id))
  if (productCount > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `No se puede borrar: ${productCount} producto(s) usan esta categoría`
    })
  }

  const childCount = await db.$count(categories, eq(categories.parentId, id))
  if (childCount > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `No se puede borrar: tiene ${childCount} subcategoría(s)`
    })
  }

  await db.delete(categories).where(eq(categories.id, id))
  return { ok: true, id }
})
