/** Valuación de inventario por mes cerrado (entradas/salidas/costo final). */
import type { ApiMonthlyInventory } from '~/types/inventario'


export function useMonthlyInventory() {
  const data = useState<ApiMonthlyInventory | null>('monthly-inventory', () => null)
  const pending = useState('monthly-inventory-pending', () => false)
  const error = useState<string | null>('monthly-inventory-error', () => null)
  const month = useState<string>('monthly-inventory-month', () => new Date().toISOString().slice(0, 7))
  const storeId = useState<number | undefined>('monthly-inventory-store', () => undefined)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      data.value = null
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) {
        data.value = null
        return
      }
      const q = new URLSearchParams({ month: month.value })
      if (storeId.value) q.set('storeId', String(storeId.value))
      data.value = await $fetch<ApiMonthlyInventory>(`/api/reports/monthly-inventory?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      data.value = null
    } finally {
      pending.value = false
    }
  }

  return { data, pending, error, month, storeId, refresh }
}