// ───────────────────────────────────────────────
//  PATCH /api/categories/:id — editar (admin)
// ───────────────────────────────────────────────
// Edita nombre/padre; valida ciclos de jerarquía.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { categories } from '../../db/schema'

interface PatchCategoryBody {
  name?: string
  parentId?: number | null
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const body = await readBody<PatchCategoryBody>(event)
  const db = useDb()

  const current = await db.query.categories.findFirst({
    where: eq(categories.id, id)
  })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Categoría no existe' })

  const patch: { name?: string; parentId?: number | null } = {}

  if (body?.name !== undefined) {
    const name = cleanText(body.name)
    if (!name) {
      throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
    }
    const dup = await db.query.categories.findFirst({
      where: (c, { sql, and, ne }) =>
        and(sql`lower(${c.name}) = lower(${name})`, ne(c.id, id))
    })
    if (dup) {
      throw createError({
        statusCode: 409,
        statusMessage: `Ya existe una categoría llamada "${name}"`
      })
    }
    patch.name = name
  }

  if (body?.parentId !== undefined) {
    if (body.parentId === null) {
      patch.parentId = null
    } else {
      const parentId = Number(body.parentId)
      if (parentId === id) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Una categoría no puede ser su propio padre'
        })
      }
      const parent = await db.query.categories.findFirst({
        where: eq(categories.id, parentId)
      })
      if (!parent) {
        throw createError({ statusCode: 400, statusMessage: 'La categoría padre no existe' })
      }
      // Evitar ciclos: subir por la cadena de padres buscando id.
      let cursor: number | null = parent.parentId
      let guard = 0
      while (cursor != null && guard++ < 100) {
        if (cursor === id) {
          throw createError({
            statusCode: 400,
            statusMessage: 'No se puede asignar como padre a un descendiente (ciclo)'
          })
        }
        const node: { parentId: number | null } | undefined =
          await db.query.categories.findFirst({
            where: eq(categories.id, cursor),
            columns: { parentId: true }
          })
        cursor = node?.parentId ?? null
      }
      patch.parentId = parentId
    }
  }

  if (Object.keys(patch).length === 0) return current

  const [updated] = await db
    .update(categories)
    .set(patch)
    .where(eq(categories.id, id))
    .returning()
  return updated
})
