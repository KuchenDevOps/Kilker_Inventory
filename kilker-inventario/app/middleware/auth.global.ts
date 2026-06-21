// Guard global de rutas (solo CLIENTE).
//
// La auth de este proyecto vive SOLO en el cliente: el path por cookie de
// @nuxtjs/supabase NO resuelve la sesión en servidor (ver memoria del proyecto:
// "supabase cookie auth roto → usar Bearer"). Por eso en SSR no podemos saber si
// hay sesión y dejamos pasar; el guard corre al hidratar y en cada navegación de
// cliente. Defensa en profundidad: los endpoints de escritura siguen exigiendo
// auth/rol en servidor (401/403), así que esto solo protege la UX de navegación.
import type { Me, UserRole } from '~/types/inventario'

export default defineNuxtRouteMiddleware(async (to) => {
  // En servidor no hay sesión resoluble → dejar pasar; el guard corre en cliente.
  if (import.meta.server) return

  const supabase = useSupabaseClient()
  const {
    data: { session }
  } = await supabase.auth.getSession()

  // Sin sesión: solo se permite /login (evita bucle de redirección).
  if (!session) {
    return to.path === '/login' ? undefined : navigateTo('/login')
  }

  // Con sesión activa, /login redirige al panel.
  if (to.path === '/login') return navigateTo('/dashboard')

  // Rutas que exigen un rol concreto (declarado con definePageMeta en el page).
  const requiredRole = to.meta.requiresRole as UserRole | undefined
  if (!requiredRole) return

  // Asegura el perfil cargado, reusando el mismo estado compartido que useMe().
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

  // Sin el rol requerido → al dashboard (los endpoints igual responderían 403).
  if (me.value?.role !== requiredRole) {
    return navigateTo('/dashboard')
  }
})
