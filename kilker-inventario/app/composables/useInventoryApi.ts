// ───────────────────────────────────────────────
//  COMPOSABLES DE LA API DE INVENTARIO
// ───────────────────────────────────────────────
// Lecturas públicas: useFetch (SSR). Llamadas autenticadas: Bearer del cliente
// (la cookie no resuelve aquí; ver §7 de CLAUDE.md).
import type {
  ApiCategory,
  ApiCorte,
  ApiMovement,
  ApiProduct,
  ApiSale,
  ApiStore,
  ApiTicket,
  ApiUser,
  Me
} from '~/types/inventario'

// transform coalesce undefined→default por si el endpoint responde 204 (cuerpo vacío).

// ───────────────────────────────────────────────
//  LECTURAS PÚBLICAS (useFetch SSR)
// ───────────────────────────────────────────────

/** Catálogo de productos con categoría y stock total. */
export function useProducts() {
  return useFetch<ApiProduct[]>('/api/products', {
    key: 'products',
    default: () => [],
    transform: (v) => v ?? []
  })
}

/** Tiendas/sucursales. */
export function useStores() {
  return useFetch<ApiStore[]>('/api/stores', {
    key: 'stores',
    default: () => [],
    transform: (v) => v ?? []
  })
}

/** Categorías para el selector de alta de producto. */
export function useCategories() {
  return useFetch<ApiCategory[]>('/api/categories', {
    key: 'categories',
    default: () => [],
    transform: (v) => v ?? []
  })
}

// ───────────────────────────────────────────────
//  LECTURAS AUTENTICADAS (Bearer del cliente)
// ───────────────────────────────────────────────

/** Perfil del usuario autenticado, compartido vía useState('me'). */
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

  // Solo el primer consumidor instala el watcher; el resto lee el estado compartido.
  const watching = useState('me-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch(user, () => void refresh(), { immediate: true })
  }

  return { me, refresh }
}

/** Historial de ventas; el backend filtra por rol. Filtros status/storeId/fecha/q recargan. */
// composables/useSales.ts
export function useSales() {
  const sales = useState<ApiSale[]>('sales', () => [])
  const pending = useState('sales-pending', () => false)
  const error = useState<string | null>('sales-error', () => null)
  const status = useState<'todas' | 'emitida' | 'anulada'>('sales-status', () => 'todas')
  const storeId = useState<number | undefined>('sales-store', () => undefined)
  const from = useState<string | undefined>('sales-from', () => undefined)
  const to = useState<string | undefined>('sales-to', () => undefined)
  const search = useState('sales-search', () => '')
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
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
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

  // ✅ Mejor: Usar un solo watcher que se ejecuta siempre
  if (import.meta.client) {
    // Watcher para cambios en los filtros
    watch([user, status, storeId, from, to, search], () => {
      refresh()
    }, { immediate: true })
    
    // Watcher para cuando la pestaña se vuelve visible
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
    
    // Cleanup cuando la app se cierra
    const nuxtApp = useNuxtApp()
    nuxtApp.hook('app:beforeUnmount', () => {
      document.removeEventListener('visibilitychange', visibilityHandler)
    })
  }

  return { sales, pending, error, status, storeId, from, to, search, refresh }
}

/** Historial de entradas de stock; el backend filtra por rol. Filtros storeId/fecha/q recargan. */
export function useMovements() {
   const movements = useState<ApiMovement[]>('movements', () => [])
  const pending = useState('movements-pending', () => false)
  const error = useState<string | null>('movements-error', () => null)
  const storeId = useState<number | undefined>('movements-store', () => undefined)
  const from = useState<string | undefined>('movements-from', () => undefined)
  const to = useState<string | undefined>('movements-to', () => undefined)
  const search = useState('movements-search', () => '')
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      movements.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        movements.value = []
        return
      }
      const q = new URLSearchParams()
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      const qs = q.toString()
      movements.value = await $fetch<ApiMovement[]>(`/api/movements${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      movements.value = []
    } finally {
      pending.value = false
    }
  }

  if (import.meta.client && !useNuxtApp()._movementsWatchScope) {
    const scope = effectScope(true) // detached: no se ata al componente actual
    useNuxtApp()._movementsWatchScope = scope
    scope.run(() => {
      watch([user, storeId, from, to, search], () => void refresh(), { immediate: true })
    })
  }

  return { movements, pending, error, storeId, from, to, search, refresh }
}

/** Tickets de corrección; filtra por rol. Llamar refresh() en onMounted. */
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

/** Cortes de caja; empleado→su tienda, admin→todas. Llamar refresh() en onMounted. */
/** Cortes de caja; empleado→su tienda, admin→todas. Filtros storeId/fecha/q recargan. */
// composables/useSales.ts - Actualizar useCortes
export function useCortes() {
  const route = useRoute()
  const router = useRouter()
  
  const cortes = useState<ApiCorte[]>('cortes', () => [])
  const pending = useState('cortes-pending', () => false)
  const error = useState<string | null>('cortes-error', () => null)
  
  const storeId = useState<number | undefined>('cortes-store', () => {
    return route.query.storeId ? Number(route.query.storeId) : undefined
  })
  
  const from = useState<string | undefined>('cortes-from', () => {
    return route.query.from as string || undefined
  })
  
  const to = useState<string | undefined>('cortes-to', () => {
    return route.query.to as string || undefined
  })
  
  const search = useState('cortes-search', () => {
    return route.query.search as string || ''
  })
  
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()
  
  let refreshing = false
  let visibilityHandler: (() => void) | null = null

  async function refresh() {
    if (refreshing) return
    refreshing = true
    
    if (!user.value) {
      cortes.value = []
      refreshing = false
      return
    }
    
    pending.value = true
    error.value = null
    
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        cortes.value = []
        refreshing = false
        return
      }
      
      const q = new URLSearchParams()
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      const qs = q.toString()
      
      cortes.value = await $fetch<ApiCorte[]>(`/api/cortes${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      cortes.value = []
    } finally {
      pending.value = false
      refreshing = false
    }
  }

  function updateUrl() {
    const query: any = {}
    if (storeId.value) query.storeId = storeId.value
    if (from.value) query.from = from.value
    if (to.value) query.to = to.value
    if (search.value) query.search = search.value
    
    const currentQuery = { ...route.query }
    delete currentQuery.storeId
    delete currentQuery.from
    delete currentQuery.to
    delete currentQuery.search
    
    router.replace({ 
      query: { 
        ...currentQuery,
        ...query 
      } 
    })
  }

  // Configurar watchers y listeners solo en el cliente
  if (import.meta.client) {
    // Watcher para cambios en los filtros
    watch([user, storeId, from, to, search], () => {
      updateUrl()
      refresh()
    }, { immediate: true })
    
    // Watcher para cambios en la URL
    watch(() => route.query, (newQuery) => {
      const newStoreId = newQuery.storeId ? Number(newQuery.storeId) : undefined
      const newFrom = newQuery.from as string || undefined
      const newTo = newQuery.to as string || undefined
      const newSearch = newQuery.search as string || ''
      
      let needsRefresh = false
      
      if (newStoreId !== storeId.value) {
        storeId.value = newStoreId
        needsRefresh = true
      }
      if (newFrom !== from.value) {
        from.value = newFrom
        needsRefresh = true
      }
      if (newTo !== to.value) {
        to.value = newTo
        needsRefresh = true
      }
      if (newSearch !== search.value) {
        search.value = newSearch
        needsRefresh = true
      }
      
      if (needsRefresh) {
        refresh()
      }
    }, { deep: true })
    
    // Listener para visibilitychange
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    document.addEventListener('visibilitychange', visibilityHandler)
  }

  onBeforeUnmount(() => {
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler)
    }
  })

  return { cortes, pending, error, storeId, from, to, search, refresh }
}

/** Usuarios/empleados (admin). Llamar refresh() en onMounted. */
export function useUsers() {
  const users = useState<ApiUser[]>('users', () => [])
  const pending = useState('users-pending', () => false)
  const error = useState<string | null>('users-error', () => null)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      users.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        users.value = []
        return
      }
      users.value = await $fetch<ApiUser[]>('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      users.value = []
    } finally {
      pending.value = false
    }
  }

  const watching = useState('users-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch(user, () => void refresh(), { immediate: true })
  }

  return { users, pending, error, refresh }
}

// ───────────────────────────────────────────────
//  ESCRITURAS Y UTILIDADES
// ───────────────────────────────────────────────

/** $fetch autenticado para escrituras: adjunta el Bearer de la sesión viva. */
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
    return (await $fetch<T>(url, {
      method: opts.method,
      body: opts.body,
      headers: {
        ...opts.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    })) as T
  }
}

/** Extrae un mensaje legible de un error de $fetch. */
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
