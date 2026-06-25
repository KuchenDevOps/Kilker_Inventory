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
  if (to.path === '/login') return navigateTo('/dashboard')

  // Rutas que exigen rol (definePageMeta requiresRole).
  const requiredRole = to.meta.requiresRole as UserRole | undefined
  if (!requiredRole) return

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

  // Sin el rol requerido → al dashboard.
  if (me.value?.role !== requiredRole) {
    return navigateTo('/dashboard')
  }
})
