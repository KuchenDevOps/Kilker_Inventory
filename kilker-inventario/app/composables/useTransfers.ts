import type { ApiTransfer } from '~/types/inventario'


export function useTransfers() {
  const transfers = useState<ApiTransfer[]>('transfers', () => [])
  const pending = useState('transfers-pending', () => false)
  const error = useState<string | null>('transfers-error', () => null)
  const storeId = useState<number | undefined>('transfers-store', () => undefined)
  const status = useState<string | undefined>('transfers-status', () => undefined)
  const from = useState<string | undefined>('transfers-from', () => undefined)
  const to = useState<string | undefined>('transfers-to', () => undefined)
  const search = useState('transfers-search', () => '')
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      transfers.value = []
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
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (status.value) q.set('status', status.value)
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      const qs = q.toString()
      transfers.value = await $fetch<ApiTransfer[]>(`/api/transfers${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      transfers.value = []
    } finally {
      pending.value = false
    }
  }

  if (import.meta.client) {
    // Watcher para cambios en los filtros
    watch([user, storeId, status, from, to, search], () => {
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

  return { transfers, pending, error, storeId, status, from, to, search, refresh }
}