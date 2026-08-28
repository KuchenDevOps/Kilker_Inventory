/** Clientes que más compraron (venta/costo/utilidad), filtrable por tienda, fecha y límite. */

import type { ApiTopCustomer } from '~/types/inventario'

export function useTopCustomers() {
  const topCustomers = useState<ApiTopCustomer[]>('top-customers', () => [])
  const pending = useState('top-customers-pending', () => false)
  const error = useState<string | null>('top-customers-error', () => null)
  const storeId = useState<number | undefined>('top-customers-store', () => undefined)
  const from = useState<string | undefined>('top-customers-from', () => undefined)
  const to = useState<string | undefined>('top-customers-to', () => undefined)
  const limit = useState<number>('top-customers-limit', () => 5)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      topCustomers.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        topCustomers.value = []
        return
      }
      const q = new URLSearchParams()
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      q.set('limit', String(limit.value))

      topCustomers.value = await $fetch<ApiTopCustomer[]>(`/api/reports/top-customers?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      topCustomers.value = []
    } finally {
      pending.value = false
    }
  }

  return { topCustomers, pending, error, storeId, from, to, limit, refresh }
}
