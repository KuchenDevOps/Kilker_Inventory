// ───────────────────────────────────────────────
//  POST /api/users — alta de usuario (admin)
// ───────────────────────────────────────────────
// Crea el usuario en Supabase Auth (contraseña definida por el admin, email ya
// confirmado) y su fila en `profiles`. Si el profile falla, revierte el usuario.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { profiles, stores, userRole } from '../../db/schema'

/** Fuente de verdad de los roles: el propio enum de Postgres. */
type UserRole = (typeof userRole.enumValues)[number]

interface NewUserBody {
  email?: string
  password?: string
  fullName?: string
  role?: UserRole
  storeId?: number | null
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })
  const body = await readBody<NewUserBody>(event)

  const email = cleanText(body?.email)?.toLowerCase() ?? null
  const password = typeof body?.password === 'string' ? body.password : ''
  const fullName = cleanText(body?.fullName)
  const role = body?.role

  if (!email || !email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Email válido es obligatorio' })
  }
  if (password.length < 8) {
    throw createError({
      statusCode: 400,
      statusMessage: 'La contraseña debe tener al menos 8 caracteres'
    })
  }
  if (!fullName) {
    throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
  }
  if (!role || !userRole.enumValues.includes(role)) {
    throw createError({ statusCode: 400, statusMessage: 'Rol inválido' })
  }

  const db = useDb()

  // Admin y observador = globales (sin tienda); empleado y admin_tienda
  // operan acotados a una sucursal, así que la exigen.
  let storeId: number | null = null
  if (isStoreScopedRole(role)) {
    storeId = Number(body?.storeId)
    if (!storeId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Este rol requiere una sucursal'
      })
    }
    const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
    if (!store) {
      throw createError({ statusCode: 400, statusMessage: 'La sucursal no existe' })
    }
  }

  const admin = useSupabaseAdmin()

  // 1) Usuario en Auth.
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  })
  if (error || !data.user) {
    const msg = error?.message ?? 'No se pudo crear el usuario'
    const dup = /registered|already|exists/i.test(msg)
    throw createError({
      statusCode: dup ? 409 : 400,
      statusMessage: dup ? 'Ya existe un usuario con ese email' : msg
    })
  }

  // 2) Profile; si falla, limpiar el usuario de Auth (evitar huérfano).
  try {
    const [created] = await db
      .insert(profiles)
      .values({ id: data.user.id, fullName, role, storeId, isActive: true })
      .returning()
    if (!created) throw new Error('insert profile sin retorno')
    return {
      id: created.id,
      email,
      fullName: created.fullName,
      role: created.role,
      storeId: created.storeId,
      isActive: created.isActive
    }
  } catch {
    await admin.auth.admin.deleteUser(data.user.id)
    throw createError({
      statusCode: 500,
      statusMessage: 'No se pudo crear el perfil; se revirtió el usuario de Auth'
    })
  }
})
