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

  // Correo y teléfono son obligatorios (decisión de negocio: no se dan de alta
  // clientes sin forma de contacto). Se valida aquí, no con un NOT NULL en la BD,
  // porque hay clientes históricos capturados sin estos datos.
  const email = cleanText(body?.email)
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'El correo es obligatorio' })
  }
  if (!isValidEmail(email)) {
    throw createError({ statusCode: 400, statusMessage: 'El correo no tiene un formato válido' })
  }

  const phone = cleanText(body?.phone)
  if (!phone) {
    throw createError({ statusCode: 400, statusMessage: 'El teléfono es obligatorio' })
  }

  const db = useDb()
  const [created] = await db
    .insert(customers)
    .values({
      name,
      rfc: cleanText(body?.rfc),
      address: cleanText(body?.address),
      email,
      phone
    })
    .returning()

  return created
})
