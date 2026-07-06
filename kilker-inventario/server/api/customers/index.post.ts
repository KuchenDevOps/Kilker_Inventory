// ───────────────────────────────────────────────
//  POST /api/customers — alta de cliente
// ───────────────────────────────────────────────
import { useDb } from '../../db'
import { customers } from '../../db/schema'

interface NewCustomerBody {
  name?: string
  rfc?: string | null
  address?: string | null
  email?: string | null
  phone?: string | null
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const body = await readBody<NewCustomerBody>(event)

  const name = cleanText(body?.name)
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
  }

  const db = useDb()
  const [created] = await db
    .insert(customers)
    .values({
      name,
      rfc: cleanText(body?.rfc),
      address: cleanText(body?.address),
      email: cleanText(body?.email),
      phone: cleanText(body?.phone)
    })
    .returning()

  return created
})