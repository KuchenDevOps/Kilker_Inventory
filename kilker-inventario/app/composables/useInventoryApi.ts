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
import type {
  ApiCategory,
  ApiCorte,
  ApiProduct,
  ApiSale,
  ApiStore,
  ApiTicket,
  Me
} from '~/types/inventario'

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
 * Historial de ventas (lectura AUTENTICADA, Bearer del cliente). El backend
 * filtra por tienda según el rol (empleado: su tienda; admin: todas). Expone los
 * filtros `status`/`storeId` como refs; al cambiarlos (o la sesión) recarga.
 */
export function useSales() {
  const sales = useState<ApiSale[]>('sales', () => [])
  const pending = useState('sales-pending', () => false)
  const error = useState<string | null>('sales-error', () => null)
  const status = useState<'todas' | 'emitida' | 'anulada'>('sales-status', () => 'todas')
  const storeId = useState<number | undefined>('sales-store', () => undefined)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      sales.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        sales.value = []
        return
      }
      const q = new URLSearchParams()
      if (status.value !== 'todas') q.set('status', status.value)
      if (storeId.value) q.set('storeId', String(storeId.value))
      const qs = q.toString()
      sales.value = await $fetch<ApiSale[]>(`/api/sales${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      sales.value = []
    } finally {
      pending.value = false
    }
  }

  const watching = useState('sales-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch([user, status, storeId], () => void refresh(), { immediate: true })
  }

  return { sales, pending, error, status, storeId, refresh }
}

/**
 * Tickets de corrección (lectura AUTENTICADA, Bearer del cliente). El backend
 * filtra por tienda según el rol. Expone `status` como ref y `refresh()`.
 * El componente debe llamar `refresh()` en `onMounted` para evitar datos viejos
 * (el watcher solo se instala una vez; ver lección de useSales).
 */
export function useTickets() {
  const tickets = useState<ApiTicket[]>('tickets', () => [])
  const pending = useState('tickets-pending', () => false)
  const error = useState<string | null>('tickets-error', () => null)
  const status = useState<'todos' | 'abierto' | 'aprobado' | 'rechazado'>(
    'tickets-status',
    () => 'todos'
  )
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      tickets.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        tickets.value = []
        return
      }
      const qs = status.value !== 'todos' ? `?status=${status.value}` : ''
      tickets.value = await $fetch<ApiTicket[]>(`/api/tickets${qs}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      tickets.value = []
    } finally {
      pending.value = false
    }
  }

  const watching = useState('tickets-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch([user, status], () => void refresh(), { immediate: true })
  }

  return { tickets, pending, error, status, refresh }
}

/**
 * Cortes de caja (lectura AUTENTICADA, Bearer del cliente). Empleado→su tienda,
 * admin→todas (con filtro `storeId`). Llamar `refresh()` en `onMounted`.
 */
export function useCortes() {
  const cortes = useState<ApiCorte[]>('cortes', () => [])
  const pending = useState('cortes-pending', () => false)
  const error = useState<string | null>('cortes-error', () => null)
  const storeId = useState<number | undefined>('cortes-store', () => undefined)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      cortes.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        cortes.value = []
        return
      }
      const qs = storeId.value ? `?storeId=${storeId.value}` : ''
      cortes.value = await $fetch<ApiCorte[]>(`/api/cortes${qs}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      cortes.value = []
    } finally {
      pending.value = false
    }
  }

  const watching = useState('cortes-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch([user, storeId], () => void refresh(), { immediate: true })
  }

  return { cortes, pending, error, storeId, refresh }
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
