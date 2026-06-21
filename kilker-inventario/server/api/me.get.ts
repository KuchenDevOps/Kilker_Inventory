// GET /api/me — perfil del usuario autenticado (o null si no hay sesión).
// No lanza 401: responde 200 + null cuando no hay sesión, para que la UI pueda
// adaptar la navegación/permisos sin tratar "sin sesión" como error.
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
