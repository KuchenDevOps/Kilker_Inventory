// ───────────────────────────────────────────────
//  PATCH /api/users/:id — editar usuario (admin y admin de sucursal)
// ───────────────────────────────────────────────
// Edita nombre/rol/sucursal/estado y, opcionalmente, la contraseña (vía Auth).
// El email no se edita aquí. Guardas anti-lockout sobre la propia cuenta.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { profiles, stores, userRole } from '../../db/schema'

/** Fuente de verdad de los roles: el propio enum de Postgres. */
type UserRole = (typeof userRole.enumValues)[number]

interface PatchUserBody {
  fullName?: string
  role?: UserRole
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
  const actor = await requireProfile(event, { role: ADMIN_AREA_ROLES })

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const body = await readBody<PatchUserBody>(event)
  const db = useDb()

  const current = await db.query.profiles.findFirst({ where: eq(profiles.id, id) })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Usuario no existe' })

  // ⚠️ Un administrador de sucursal solo toca a SU gente. Las dos guardas son
  // necesarias y distintas: la primera impide editar a alguien de otra tienda
  // (o a un admin/observador, que van sin tienda y nunca coinciden), y la
  // segunda impide llevarse a un usuario a otra sucursal o cambiarle el rol por
  // uno global. Sin la segunda, editar a su propio empleado bastaba para
  // ponerse —o ponerle— el rol `admin`, que es la escalada que este reparto de
  // permisos existe para evitar.
  assertOwnStore(actor, current.storeId)

  const editingSelf = actor.id === id

  const patch: {
    fullName?: string
    role?: UserRole
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
    if (!userRole.enumValues.includes(body.role)) {
      throw createError({ statusCode: 400, statusMessage: 'Rol inválido' })
    }
    if (editingSelf && current.role === 'admin' && body.role !== 'admin') {
      throw createError({
        statusCode: 400,
        statusMessage: 'No puedes quitarte tu propio rol de administrador'
      })
    }
    assertCanAssignRole(actor, body.role)
    patch.role = body.role
  }

  // Sucursal coherente con el rol resultante: los roles acotados ('empleado' y
  // 'admin_tienda') operan en una sucursal; admin y observador son globales
  // (storeId null).
  const nextRole = body?.role ?? current.role
  if (!isStoreScopedRole(nextRole)) {
    patch.storeId = null
  } else {
    // Para un actor acotado la sucursal destino es SIEMPRE la suya: el
    // `storeId` del body se ignora, así que no puede mover a nadie de tienda.
    const targetStoreId = resolveTargetStoreId(
      actor,
      body?.storeId !== undefined ? Number(body.storeId) : current.storeId
    )
    if (!targetStoreId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Este rol requiere una sucursal'
      })
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
  //
  // ⚠️ El administrador de SUCURSAL no la toca. Cambiarle la contraseña a
  // alguien es poder entrar como esa persona: firmaría ventas, cortes y gastos
  // con el nombre de otro, y la bitácora (`created_by`, `edited_by`, `voided_by`)
  // dejaría de decir quién hizo cada cosa — que es lo único que sostiene el
  // rastro de todo el sistema. El alta SÍ lleva contraseña inicial: ahí no hay
  // sesión de nadie que suplantar todavía, y sin ella no podría dar de alta a su
  // gente. Reponer una olvidada se le pide al admin de la empresa.
  if (typeof body?.password === 'string' && body.password.length > 0) {
    if (isStoreScopedRole(actor.role)) {
      throw createError({
        statusCode: 403,
        statusMessage:
          'Cambiar la contraseña de un usuario es exclusivo del administrador de la empresa'
      })
    }
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

  // requireProfile cachea el perfil por token durante un rato: sin esto, un
  // cambio de rol/sucursal o una baja tardarían hasta el TTL en aplicarse.
  invalidateProfileCache(id)

  return updated
})
