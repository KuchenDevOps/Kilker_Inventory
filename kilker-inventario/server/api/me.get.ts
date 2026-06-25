// ───────────────────────────────────────────────
//  GET /api/me — perfil autenticado
// ───────────────────────────────────────────────
// Responde 200 + null si no hay sesión (no lanza 401).
export default defineEventHandler(async (event) => {
  const profile = await getOptionalProfile(event)
  if (!profile) return null
  return {
    id: profile.id,
    fullName: profile.fullName,
    role: profile.role,
    storeId: profile.storeId
  }
})
