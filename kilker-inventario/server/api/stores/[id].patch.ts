// ───────────────────────────────────────────────
//  PATCH /api/stores/:id — editar sucursal (admin)
// ───────────────────────────────────────────────
// Edita nombre/dirección/estado. El código NO es editable (se usa en folios de factura).
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { stores } from '../../db/schema'

interface PatchStoreBody {
  name?: string
  address?: string | null
  isActive?: boolean
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

  const body = await readBody<PatchStoreBody>(event)
  const db = useDb()

  const current = await db.query.stores.findFirst({ where: eq(stores.id, id) })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Sucursal no existe' })

  const patch: { name?: string; address?: string | null; isActive?: boolean } = {}

  if (body?.name !== undefined) {
    const name = cleanText(body.name)
    if (!name) {
      throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
    }
    patch.name = name
  }
  if (body?.address !== undefined) {
    patch.address = cleanText(body.address)
  }
  if (body?.isActive !== undefined) {
    patch.isActive = Boolean(body.isActive)
  }

  if (Object.keys(patch).length === 0) return current

  const [updated] = await db
    .update(stores)
    .set(patch)
    .where(eq(stores.id, id))
    .returning()
  return updated
})
