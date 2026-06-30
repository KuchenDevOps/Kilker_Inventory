// ───────────────────────────────────────────────
//  POST /api/stores — alta de sucursal (admin)
// ───────────────────────────────────────────────
// name y code obligatorios; code único (case-insensitive). address opcional.
import { useDb } from '../../db'
import { stores } from '../../db/schema'

interface NewStoreBody {
  name?: string
  code?: string
  address?: string | null
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })
  const body = await readBody<NewStoreBody>(event)

  const name = cleanText(body?.name)
  const code = cleanText(body?.code)
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
  }
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'El código es obligatorio' })
  }

  const db = useDb()

  // Código único (case-insensitive).
  const dup = await db.query.stores.findFirst({
    where: (s, { sql }) => sql`lower(${s.code}) = lower(${code})`
  })
  if (dup) {
    throw createError({
      statusCode: 409,
      statusMessage: `Ya existe una sucursal con el código "${code}"`
    })
  }

  const [created] = await db
    .insert(stores)
    .values({ name, code, address: cleanText(body?.address) })
    .returning()
  return created
})
