// ───────────────────────────────────────────────
//  GET /api/users — usuarios/empleados (admin, admin_tienda y observador)
// ───────────────────────────────────────────────
// Perfiles enriquecidos con sucursal (código/nombre) y email (desde Auth).
// El observador solo consulta: el candado central de `requireProfile` ya le
// rechaza cualquier método distinto de GET.
//
// ⚠️ El administrador de SUCURSAL solo ve a su gente. El recorte va en el
// `where` y no en el `map`, para que el `count()` de la paginación cuente lo
// mismo que la página: filtrando después, la lista salía corta pero el total
// decía cuántos usuarios hay en toda la empresa, y de paso filtraba las páginas
// una por una. El corte es `isStoreScopedRole`, no `role === 'admin_tienda'`.
import { count, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { profiles } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, {
    role: [...ADMIN_AREA_ROLES, 'observador']
  })
  const query = getQuery(event)
  const db = useDb()

  // Un rol acotado sin sucursal asignada no ve a nadie (mismo criterio que el
  // resto de endpoints: vacío, no error).
  const scoped = isStoreScopedRole(profile.role)
  if (scoped && profile.storeId == null) {
    return query.page ? { data: [], total: 0, page: 1, pageSize: 20 } : []
  }
  const whereClause = scoped ? eq(profiles.storeId, profile.storeId!) : undefined

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.profiles.findMany({
    where: whereClause,
    with: { store: { columns: { code: true, name: true } } },
    orderBy: (p, { asc }) => [asc(p.fullName)],
    ...(paginate
      ? { limit: pageSize, offset: (page - 1) * pageSize }
      : { limit: 200, offset: 0 })
  })

  // Emails desde Supabase Auth (admin API).
  const admin = useSupabaseAdmin()
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'No se pudieron leer los usuarios de Auth'
    })
  }
  const emailById = new Map(data.users.map((u) => [u.id, u.email ?? null]))

  const mapped = rows.map((p) => ({
    id: p.id,
    email: emailById.get(p.id) ?? null,
    fullName: p.fullName,
    role: p.role,
    storeId: p.storeId,
    storeCode: p.store?.code ?? null,
    storeName: p.store?.name ?? null,
    isActive: p.isActive,
    createdAt: p.createdAt
  }))

  if (!paginate) return mapped

  const totalCount =
    (await db.select({ value: count() }).from(profiles).where(whereClause))[0]?.value ?? 0

  return {
    data: mapped,
    total: totalCount,
    page,
    pageSize
  }
})