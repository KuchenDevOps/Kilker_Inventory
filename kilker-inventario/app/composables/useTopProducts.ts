/** Productos más vendidos (ingresos/cantidad), filtrable por tienda, fecha y límite. */

import type { ApiTopProduct } from '~/types/inventario'

export function useTopProducts() {
  const topProducts = useState<ApiTopProduct[]>('top-products', () => [])
  const pending = useState('top-products-pending', () => false)
  const error = useState<string | null>('top-products-error', () => null)
  const storeId = useState<number | undefined>('top-products-store', () => undefined)
  const from = useState<string | undefined>('top-products-from', () => undefined)
  const to = useState<string | undefined>('top-products-to', () => undefined)
  const limit = useState<number>('top-products-limit', () => 5)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      topProducts.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        topProducts.value = []
        return
      }
      const q = new URLSearchParams()
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      q.set('limit', String(limit.value))
      topProducts.value = await $fetch<ApiTopProduct[]>(`/api/reports/top-products?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      topProducts.value = []
    } finally {
      pending.value = false
    }
  }

  return { topProducts, pending, error, storeId, from, to, limit, refresh }
}