// POST /api/categories — alta de una categoría/línea de producto (solo admin).
// `parentId` opcional (jerarquía); si viene debe existir.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { categories } from '../../db/schema'

interface NewCategoryBody {
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
  const body = await readBody<NewCategoryBody>(event)

  const name = cleanText(body?.name)
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
  }

  const db = useDb()

  // Nombre único (case-insensitive) para evitar duplicados confusos.
  const dup = await db.query.categories.findFirst({
    where: (c, { sql }) => sql`lower(${c.name}) = lower(${name})`
  })
  if (dup) {
    throw createError({
      statusCode: 409,
      statusMessage: `Ya existe una categoría llamada "${name}"`
    })
  }

  let parentId: number | null = null
  if (body?.parentId != null) {
    parentId = Number(body.parentId)
    const parent = await db.query.categories.findFirst({
      where: eq(categories.id, parentId)
    })
    if (!parent) {
      throw createError({ statusCode: 400, statusMessage: 'La categoría padre no existe' })
    }
  }

  const [created] = await db.insert(categories).values({ name, parentId }).returning()
  return created
})
