import type { ApiTransfer } from '~/types/inventario'


export function useTransfers() {
  const transfers = useState<ApiTransfer[]>('transfers', () => [])
  const pending = useState('transfers-pending', () => false)
  const error = useState<string | null>('transfers-error', () => null)
  const storeId = useState<number | undefined>('transfers-store', () => undefined)
  const status = useState<string | undefined>('transfers-status', () => undefined)
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

  return { transfers, pending, error, storeId, status, refresh }
}