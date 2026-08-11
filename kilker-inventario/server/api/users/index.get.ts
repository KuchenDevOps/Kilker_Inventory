// ───────────────────────────────────────────────
//  GET /api/users — usuarios/empleados (admin + observador)
// ───────────────────────────────────────────────
// Perfiles enriquecidos con sucursal (código/nombre) y email (desde Auth).
// El observador solo consulta: el alta (POST) y la edición (PATCH) siguen
// siendo exclusivas de admin, y el candado central de `requireProfile` ya le
// rechaza cualquier método distinto de GET.
import { count } from 'drizzle-orm'
import { useDb } from '../../db'
import { profiles } from '../../db/schema'

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: ['admin', 'observador'] })
  const query = getQuery(event)
  const db = useDb()

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.profiles.findMany({
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

  const [{ value: totalCount }] = await db.select({ value: count() }).from(profiles)

  return {
    data: mapped,
    total: totalCount,
    page,
    pageSize
  }
})