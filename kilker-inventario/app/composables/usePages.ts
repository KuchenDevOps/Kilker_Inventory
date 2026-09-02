import type {
  ApiMovement,
  ApiMovementsPage,
  ApiMovementsTotals,
  ApiSale,
  ApiSalesPage,
  ApiSalesTotals,
  ApiTransfer,
  ApiUser,
  ApiTicket,
  ApiCorte,
  TicketTarget
} from '~/types/inventario'

/**
 * Sumatorias en cero. Se usan como estado inicial y como reset: mientras la
 * petición está en vuelo (o falló) la tarjeta muestra $0, no la cifra del
 * filtro anterior, que es peor que no mostrar nada.
 */
const ZERO_MOVEMENT_TOTALS: ApiMovementsTotals = {
  activeCount: 0,
  activeAmount: 0,
  voidedCount: 0,
  voidedAmount: 0
}

const ZERO_SALES_TOTALS: ApiSalesTotals = {
  issuedCount: 0,
  issuedAmount: 0,
  voidedCount: 0,
  voidedAmount: 0
}

export function useMovementsHistory() {
  const movements = useState<ApiMovement[]>('movements-history', () => [])
  const total = useState('movements-history-total', () => 0)
  const totals = useState<ApiMovementsTotals>('movements-history-totals', () => ({
    ...ZERO_MOVEMENT_TOTALS
  }))
  const page = useState('movements-history-page', () => 1)
  const pageSize = useState('movements-history-pagesize', () => 100)
  const pending = useState('movements-history-pending', () => false)
  const error = useState<string | null>('movements-history-error', () => null)
  const storeId = useState<number | undefined>('movements-history-store', () => undefined)
  const from = useState<string | undefined>('movements-history-from', () => undefined)
  const to = useState<string | undefined>('movements-history-to', () => undefined)
  const search = useState('movements-history-search', () => '')
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      movements.value = []
      total.value = 0
      totals.value = { ...ZERO_MOVEMENT_TOTALS }
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        movements.value = []
        totals.value = { ...ZERO_MOVEMENT_TOTALS }
        return
      }
      const q = new URLSearchParams()
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      const res = await $fetch<ApiMovementsPage>(
        `/api/movements?${q.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      movements.value = res.data
      total.value = res.total
      totals.value = res.totals ?? { ...ZERO_MOVEMENT_TOTALS }
    } catch (e) {
      error.value = apiErrorMessage(e)
      movements.value = []
      totals.value = { ...ZERO_MOVEMENT_TOTALS }
    } finally {
      pending.value = false
    }
  }

  useSharedScope('movements-history', () => {
    // Cambios de filtro regresan a página 1
    watch([user, storeId, from, to, search], () => { page.value = 1; void refresh() }, { immediate: true })
    // Cambio de página solo re-fetchea
    watch(page, () => void refresh())
  })

  return { movements, total, totals, page, pageSize, pending, error, storeId, from, to, search, refresh }
}

export function useSalesHistory() {
  const sales = useState<ApiSale[]>('sales-history', () => [])
  const total = useState('sales-history-total', () => 0)
  const totals = useState<ApiSalesTotals>('sales-history-totals', () => ({ ...ZERO_SALES_TOTALS }))
  const page = useState('sales-history-page', () => 1)
  const pageSize = useState('sales-history-pagesize', () => 100)
  const pending = useState('sales-history-pending', () => false)
  const error = useState<string | null>('sales-history-error', () => null)
  const status = useState<'todas' | 'emitida' | 'anulada'>('sales-history-status', () => 'todas')
  const storeId = useState<number | undefined>('sales-history-store', () => undefined)
  const productId = useState<number | undefined>('sales-history-product', () => undefined)
  const from = useState<string | undefined>('sales-history-from', () => undefined)
  const to = useState<string | undefined>('sales-history-to', () => undefined)
  const search = useState('sales-history-search', () => '')
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      sales.value = []
      total.value = 0
      totals.value = { ...ZERO_SALES_TOTALS }
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        sales.value = []
        totals.value = { ...ZERO_SALES_TOTALS }
        return
      }
      const q = new URLSearchParams()
      if (status.value !== 'todas') q.set('status', status.value)
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (productId.value) q.set('productId', String(productId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      const res = await $fetch<ApiSalesPage | ApiSale[]>(
  `/api/sales?${q.toString()}`,
  { headers: { Authorization: `Bearer ${token}` } }
)

if (Array.isArray(res)) {
  // Respuesta sin envolver (no debería pasar con ?page, pero por si acaso).
  // Sin sumatoria del servidor no se inventa una con la página: cero.
  sales.value = res
  total.value = res.length
  totals.value = { ...ZERO_SALES_TOTALS }
} else {
  sales.value = res?.data ?? []
  total.value = res?.total ?? 0
  totals.value = res?.totals ?? { ...ZERO_SALES_TOTALS }
}

    } catch (e) {
      error.value = apiErrorMessage(e)
      sales.value = []
      totals.value = { ...ZERO_SALES_TOTALS }
    } finally {
      pending.value = false
    }
  }

  useSharedScope('sales-history', () => {
    watch([user, status, storeId, productId, from, to, search], () => { page.value = 1; void refresh() }, { immediate: true })
    watch(page, () => void refresh())
  })

  return { sales, total, totals, page, pageSize, pending, error, status, storeId, productId, from, to, search, refresh }
}

export function useTransferHistory() {
  const transfers = useState<ApiTransfer[]>('transfers-history', () => [])
  const total = useState('transfers-history-total', () => 0)
  const page = useState('transfers-history-page', () => 1)
  const pageSize = useState('transfers-history-pagesize', () => 100)
  const pending = useState('transfers-history-pending', () => false)
  const error = useState<string | null>('transfers-history-error', () => null)
  const status = useState<'todas' | TransferStatus>('transfers-history-status', () => 'todas')
  const storeId = useState<number | undefined>('transfers-history-store', () => undefined)
  const productId = useState<number | undefined>('transfers-history-product', () => undefined)
  const from = useState<string | undefined>('transfers-history-from', () => undefined)
  const to = useState<string | undefined>('transfers-history-to', () => undefined)
  const search = useState('transfers-history-search', () => '')
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      transfers.value = []
      total.value = 0
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        transfers.value = []
        return
      }
      const q = new URLSearchParams()
      if (status.value !== 'todas') q.set('status', status.value)
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (productId.value) q.set('productId', String(productId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      const res = await $fetch<{ data: ApiTransfer[]; total: number; page: number; pageSize: number }>(
        `/api/transfers?${q.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      transfers.value = res.data
      total.value = res.total
    } catch (e) {
      error.value = apiErrorMessage(e)
      transfers.value = []
    } finally {
      pending.value = false
    }
  }

  useSharedScope('transfers-history', () => {
    // Cambios de filtro regresan a página 1
    watch([user, status, storeId, productId, from, to, search], () => { page.value = 1; void refresh() }, { immediate: true })
    // Cambio de página solo re-fetchea
    watch(page, () => void refresh())
  })

  return { transfers, total, page, pageSize, pending, error, status, storeId, productId, from, to, search, refresh }
}


/**
 * Tickets de corrección de UN objetivo concreto ('factura' o 'movimiento').
 *
 * ⚠️ Todo el estado va namespaced por `target`: /tickets/ventas y
 * /tickets/entradas usan este mismo composable, y con claves compartidas de
 * `useState` una pantalla pisaría el listado y el filtro de la otra.
 */
export function useTicketsHistory(target: TicketTarget) {
  const ns = `tickets-${target}`
  const tickets = useState<ApiTicket[]>(ns, () => [])
  const total = useState(`${ns}-total`, () => 0)
  const page = useState(`${ns}-page`, () => 1)
  const pageSize = useState(`${ns}-pagesize`, () => 100)
  const pending = useState(`${ns}-pending`, () => false)
  const error = useState<string | null>(`${ns}-error`, () => null)
  const status = useState<'todos' | 'abierto' | 'aprobado' | 'rechazado'>(
    `${ns}-status`,
    () => 'todos'
  )
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      tickets.value = []
      total.value = 0
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
      const q = new URLSearchParams()
      q.set('target', target)
      if (status.value !== 'todos') q.set('status', status.value)
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      const res = await $fetch<{ data: ApiTicket[]; total: number; page: number; pageSize: number }>(
        `/api/tickets?${q.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      tickets.value = res.data
      total.value = res.total
    } catch (e) {
      error.value = apiErrorMessage(e)
      tickets.value = []
    } finally {
      pending.value = false
    }
  }

  // Ojo: clave propia. Antes compartía la bandera 'tickets-watching' con
  // useTickets() de useInventoryApi.ts, así que el primero en montarse dejaba
  // al otro sin watchers.
  useSharedScope(`${ns}-history`, () => {
    watch([user, status], () => { page.value = 1; void refresh() }, { immediate: true })
    watch(page, () => void refresh())
  })

  return { tickets, total, page, pageSize, pending, error, status, refresh }
}

/** Cortes de caja; empleado→su tienda, admin→todas. Llamar refresh() en onMounted. */
/** Cortes de caja; empleado→su tienda, admin→todas. Filtros storeId/fecha/q recargan. */
// composables/useSales.ts - Actualizar useCortes
export function useCortesHistory() {
  const route = useRoute()
  const router = useRouter()

  const cortes = useState<ApiCorte[]>('cortes', () => [])
  const total = useState('cortes-total', () => 0)
  const page = useState('cortes-page', () => 1)
  const pageSize = useState('cortes-pagesize', () => 100)
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
      total.value = 0
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
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))
      const qs = q.toString()

      const res = await $fetch<{ data: ApiCorte[]; total: number; page: number; pageSize: number }>(
        `/api/cortes${qs ? `?${qs}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      cortes.value = res.data
      total.value = res.total
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

  if (import.meta.client) {
    // Cambios de filtro regresan a página 1 y actualizan la URL
    watch([user, storeId, from, to, search], () => {
      page.value = 1
      updateUrl()
      refresh()
    }, { immediate: true })

    // Cambio de página solo re-fetchea
    watch(page, () => void refresh())

    // Cambios en la URL (ej. navegación con botones atrás/adelante)
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
        page.value = 1
        refresh()
      }
    }, { deep: true })

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

  return { cortes, total, page, pageSize, pending, error, storeId, from, to, search, refresh }
}

/** Usuarios/empleados (admin). Llamar refresh() en onMounted. */
export function useUsersHistory() {
  const users = useState<ApiUser[]>('users', () => [])
  const total = useState('users-total', () => 0)
  const page = useState('users-page', () => 1)
  const pageSize = useState('users-pagesize', () => 100)
  const pending = useState('users-pending', () => false)
  const error = useState<string | null>('users-error', () => null)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      users.value = []
      total.value = 0
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
      const q = new URLSearchParams()
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      const res = await $fetch<{ data: ApiUser[]; total: number; page: number; pageSize: number }>(
        `/api/users?${q.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      users.value = res.data
      total.value = res.total
    } catch (e) {
      error.value = apiErrorMessage(e)
      users.value = []
    } finally {
      pending.value = false
    }
  }

  useSharedScope('users-history', () => {
    watch(user, () => { page.value = 1; void refresh() }, { immediate: true })
    watch(page, () => void refresh())
  })

  return { users, total, page, pageSize, pending, error, refresh }
}