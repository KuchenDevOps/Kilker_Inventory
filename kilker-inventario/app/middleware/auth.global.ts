// ───────────────────────────────────────────────
//  GUARD GLOBAL DE RUTAS (solo cliente)
// ───────────────────────────────────────────────
// La auth vive solo en cliente (cookie no resuelve en SSR). Endpoints igual exigen rol.
import type { Me, UserRole } from '~/types/inventario'

export default defineNuxtRouteMiddleware(async (to) => {
  // SSR no resuelve sesión → dejar pasar; el guard corre en cliente.
  if (import.meta.server) return

  const supabase = useSupabaseClient()
  const {
    data: { session }
  } = await supabase.auth.getSession()

  // Sin sesión: solo se permite /login.
  if (!session) {
    return to.path === '/login' ? undefined : navigateTo('/login')
  }

  // Con sesión activa, /login redirige al panel.
  if (to.path === '/login') return navigateTo(HOME_ROUTE)

  // Rutas que exigen rol (definePageMeta requiresRole). Acepta un rol o una
  // lista: /tiendas y /empleados los ve admin y observador (este último en
  // modo consulta; la propia página esconde las acciones de escritura).
  const requiredRole = to.meta.requiresRole as UserRole | UserRole[] | undefined
  if (!requiredRole) return
  const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]

  // Carga el perfil reusando el estado compartido de useMe().
  const me = useState<Me | null>('me', () => null)
  if (!me.value) {
    try {
      me.value =
        (await $fetch<Me | null>('/api/me', {
          headers: { Authorization: `Bearer ${session.access_token}` }
        })) ?? null
    } catch {
      me.value = null
    }
  }

  // Sin el rol requerido → a la pantalla de entrada.
  //
  // ⚠️ `HOME_ROUTE` NO debe declarar `requiresRole`: es el destino de este
  // rebote, así que si ella misma pudiera rechazar a alguien, ese usuario
  // quedaría rebotando entre las dos rutas en vez de ver un 403.
  if (!me.value || !allowedRoles.includes(me.value.role)) {
    return navigateTo(HOME_ROUTE)
  }
})
