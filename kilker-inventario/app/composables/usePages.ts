import type { ApiMovement } from '~/types/inventario'


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