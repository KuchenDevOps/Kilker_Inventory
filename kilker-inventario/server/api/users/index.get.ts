// ───────────────────────────────────────────────
//  GET /api/users — usuarios/empleados (admin)
// ───────────────────────────────────────────────
// Perfiles enriquecidos con sucursal (código/nombre) y email (desde Auth).
import { useDb } from '../../db'

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })
  const db = useDb()

  const rows = await db.query.profiles.findMany({
    with: { store: { columns: { code: true, name: true } } },
    orderBy: (p, { asc }) => [asc(p.fullName)]
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

  return rows.map((p) => ({
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
})
