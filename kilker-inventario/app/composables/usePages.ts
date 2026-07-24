import type { ApiMovement, ApiSale, ApiTransfer } from '~/types/inventario'


export function useMovementsHistory() {
  const movements = useState<ApiMovement[]>('movements-history', () => [])
  const total = useState('movements-history-total', () => 0)
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
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      const res = await $fetch<{ data: ApiMovement[]; total: number; page: number; pageSize: number }>(
        `/api/movements?${q.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      movements.value = res.data
      total.value = res.total
    } catch (e) {
      error.value = apiErrorMessage(e)
      movements.value = []
    } finally {
      pending.value = false
    }
  }

  if (import.meta.client && !useNuxtApp()._movementsHistoryWatchScope) {
    const scope = effectScope(true)
    useNuxtApp()._movementsHistoryWatchScope = scope
    scope.run(() => {
      // Cambios de filtro regresan a página 1
      watch([user, storeId, from, to, search], () => { page.value = 1; void refresh() }, { immediate: true })
      // Cambio de página solo re-fetchea
      watch(page, () => void refresh())
    })
  }

  return { movements, total, page, pageSize, pending, error, storeId, from, to, search, refresh }
}

export function useSalesHistory() {
  const sales = useState<ApiSale[]>('sales-history', () => [])
  const total = useState('sales-history-total', () => 0)
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
      if (productId.value) q.set('productId', String(productId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      const res = await $fetch<{ data: ApiSale[]; total: number; page: number; pageSize: number }>(
        `/api/sales?${q.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      sales.value = res.data
      total.value = res.total
    } catch (e) {
      error.value = apiErrorMessage(e)
      sales.value = []
    } finally {
      pending.value = false
    }
  }

  if (import.meta.client && !useNuxtApp()._salesHistoryWatchScope) {
    const scope = effectScope(true)
    useNuxtApp()._salesHistoryWatchScope = scope
    scope.run(() => {
      watch([user, status, storeId, productId, from, to, search], () => { page.value = 1; void refresh() }, { immediate: true })
      watch(page, () => void refresh())
    })
  }

  return { sales, total, page, pageSize, pending, error, status, storeId, productId, from, to, search, refresh }
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

  if (import.meta.client && !useNuxtApp()._transfersHistoryWatchScope) {
    const scope = effectScope(true)
    useNuxtApp()._transfersHistoryWatchScope = scope
    scope.run(() => {
      // Cambios de filtro regresan a página 1
      watch([user, status, storeId, productId, from, to, search], () => { page.value = 1; void refresh() }, { immediate: true })
      // Cambio de página solo re-fetchea
      watch(page, () => void refresh())
    })
  }

  return { transfers, total, page, pageSize, pending, error, status, storeId, productId, from, to, search, refresh }
}