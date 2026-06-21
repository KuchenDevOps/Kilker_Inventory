// Composables de acceso a la API del inventario.
//
// LECTURAS PÚBLICAS (products/stores/categories): useFetch con SSR y caché por
// `key`. No requieren auth.
//
// LLAMADAS AUTENTICADAS (/api/me y escrituras): se hacen en cliente adjuntando
// `Authorization: Bearer <access_token>` tomado de la sesión viva de Supabase.
// Motivo: con este setup de @nuxtjs/supabase, el path por COOKIE de
// `serverSupabaseUser` no resuelve el usuario aunque la cookie sea válida; el
// path Bearer sí (verificado). `requireProfile` ya soporta ambos. El cliente
// siempre tiene un token fresco (auto-refresh), así que Bearer es robusto.
import type { ApiCategory, ApiProduct, ApiStore, Me } from '~/types/inventario'

// El `transform` coalesce `undefined → default`: si un endpoint responde 204
// (cuerpo vacío), ofetch resuelve `undefined` y Nuxt avisaría "must return a value".

/** Catálogo de productos con su categoría y stock total (lectura pública). */
export function useProducts() {
  return useFetch<ApiProduct[]>('/api/products', {
    key: 'products',
    default: () => [],
    transform: (v) => v ?? []
  })
}

/** Tiendas/sucursales (lectura pública). */
export function useStores() {
  return useFetch<ApiStore[]>('/api/stores', {
    key: 'stores',
    default: () => [],
    transform: (v) => v ?? []
  })
}

/** Categorías para el selector de alta de producto (lectura pública). */
export function useCategories() {
  return useFetch<ApiCategory[]>('/api/categories', {
    key: 'categories',
    default: () => [],
    transform: (v) => v ?? []
  })
}

/**
 * Perfil del usuario autenticado, compartido por toda la app (`useState('me')`).
 * Se resuelve en CLIENTE con Bearer y se re-resuelve cuando cambia la sesión
 * (login/logout). En SSR queda `null` (la barra de rol hidrata tras el montaje).
 */
export function useMe() {
  const me = useState<Me | null>('me', () => null)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      me.value = null
      return
    }
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      me.value = token
        ? ((await $fetch<Me | null>('/api/me', {
            headers: { Authorization: `Bearer ${token}` }
          })) ?? null)
        : null
    } catch {
      me.value = null
    }
  }

  // Solo el primer consumidor (el layout, que vive toda la sesión) instala el
  // watcher; el resto de componentes solo leen el estado compartido `me`.
  const watching = useState('me-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch(user, () => void refresh(), { immediate: true })
  }

  return { me, refresh }
}

/**
 * `$fetch` autenticado para ESCRITURAS: adjunta el Bearer de la sesión viva.
 * Llamar en el `setup` del componente (captura el cliente Supabase); usar el
 * wrapper devuelto dentro de los handlers de eventos.
 */
export function useApiFetch() {
  const supabase = useSupabaseClient()
  return async <T = unknown>(
    url: string,
    opts: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      body?: Record<string, unknown>
      headers?: Record<string, string>
    } = {}
  ): Promise<T> => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    return await $fetch<T>(url, {
      method: opts.method,
      body: opts.body,
      headers: {
        ...opts.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })
  }
}

/** Extrae un mensaje legible de un error de $fetch (FetchError de ofetch). */
export function apiErrorMessage(e: unknown, fallback = 'Ocurrió un error.'): string {
  const err = e as {
    data?: { statusMessage?: string; message?: string }
    statusMessage?: string
    message?: string
  }
  return (
    err?.data?.statusMessage ||
    err?.data?.message ||
    err?.statusMessage ||
    err?.message ||
    fallback
  )
}
