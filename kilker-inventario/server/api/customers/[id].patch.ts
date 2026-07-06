// ───────────────────────────────────────────────
//  PATCH /api/customers/:id — editar cliente
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { customers } from '../../db/schema'

interface CustomerUpdateBody {
  name?: string
  rfc?: string | null
  address?: string | null
  email?: string | null
  phone?: string | null
  isActive?: boolean
}

function cleanText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'ID inválido' })
  }
  const body = await readBody<CustomerUpdateBody>(event)

  const db = useDb()
  const existing = await db.query.customers.findFirst({ where: eq(customers.id, id) })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Cliente no existe' })
  }

  const values: Partial<typeof customers.$inferInsert> = {}
  if (body.name !== undefined) {
    const name = cleanText(body.name)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'El nombre no puede quedar vacío' })
    values.name = name
  }
  if (body.rfc !== undefined) values.rfc = cleanText(body.rfc)
  if (body.address !== undefined) values.address = cleanText(body.address)
  if (body.email !== undefined) values.email = cleanText(body.email)
  if (body.phone !== undefined) values.phone = cleanText(body.phone)
  if (body.isActive !== undefined) values.isActive = body.isActive

  const [updated] = await db
    .update(customers)
    .set(values)
    .where(eq(customers.id, id))
    .returning()

  return updated
})