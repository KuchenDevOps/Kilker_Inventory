// ───────────────────────────────────────────────
//  PATCH /api/users/:id — editar usuario (admin)
// ───────────────────────────────────────────────
// Edita nombre/rol/sucursal/estado y, opcionalmente, la contraseña (vía Auth).
// El email no se edita aquí. Guardas anti-lockout sobre la propia cuenta.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { profiles, stores } from '../../db/schema'

interface PatchUserBody {
  fullName?: string
  role?: 'admin' | 'empleado'
  storeId?: number | null
  isActive?: boolean
  password?: string
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  const actor = await requireProfile(event, { role: 'admin' })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const body = await readBody<PatchUserBody>(event)
  const db = useDb()

  const current = await db.query.profiles.findFirst({ where: eq(profiles.id, id) })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Usuario no existe' })

  const editingSelf = actor.id === id

  const patch: {
    fullName?: string
    role?: 'admin' | 'empleado'
    storeId?: number | null
    isActive?: boolean
  } = {}

  // Nombre.
  if (body?.fullName !== undefined) {
    const name = cleanText(body.fullName)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
    patch.fullName = name
  }

  // Rol (con guarda: no quitarte tu propio admin).
  if (body?.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'empleado') {
      throw createError({ statusCode: 400, statusMessage: 'Rol inválido' })
    }
    if (editingSelf && current.role === 'admin' && body.role !== 'admin') {
      throw createError({
        statusCode: 400,
        statusMessage: 'No puedes quitarte tu propio rol de administrador'
      })
    }
    patch.role = body.role
  }

  // Sucursal coherente con el rol resultante.
  const nextRole = body?.role ?? current.role
  if (nextRole === 'admin') {
    patch.storeId = null
  } else {
    const targetStoreId =
      body?.storeId !== undefined ? Number(body.storeId) : current.storeId
    if (!targetStoreId) {
      throw createError({ statusCode: 400, statusMessage: 'El empleado requiere una sucursal' })
    }
    if (body?.storeId !== undefined) {
      const store = await db.query.stores.findFirst({ where: eq(stores.id, targetStoreId) })
      if (!store) {
        throw createError({ statusCode: 400, statusMessage: 'La sucursal no existe' })
      }
    }
    patch.storeId = targetStoreId
  }

  // Estado (con guarda: no desactivarte a ti mismo).
  if (body?.isActive !== undefined) {
    if (editingSelf && body.isActive === false) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No puedes desactivar tu propia cuenta'
      })
    }
    patch.isActive = Boolean(body.isActive)
  }

  // Contraseña (opcional) → Auth.
  if (typeof body?.password === 'string' && body.password.length > 0) {
    if (body.password.length < 8) {
      throw createError({
        statusCode: 400,
        statusMessage: 'La contraseña debe tener al menos 8 caracteres'
      })
    }
    const admin = useSupabaseAdmin()
    const { error } = await admin.auth.admin.updateUserById(id, { password: body.password })
    if (error) {
      throw createError({ statusCode: 502, statusMessage: 'No se pudo actualizar la contraseña' })
    }
  }

  if (Object.keys(patch).length === 0) return current

  const [updated] = await db
    .update(profiles)
    .set(patch)
    .where(eq(profiles.id, id))
    .returning()
  return updated
})
