import type { ApiExpense } from '~/types/inventario'


/** Gastos operativos por sucursal. */
export function useExpenses() {
  const expenses = useState<ApiExpense[]>('expenses', () => [])
  const pending = useState('expenses-pending', () => false)
  const error = useState<string | null>('expenses-error', () => null)
  const storeId = useState<number | undefined>('expenses-store', () => undefined)
  const from = useState<string | undefined>('expenses-from', () => undefined)
  const to = useState<string | undefined>('expenses-to', () => undefined)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      expenses.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        expenses.value = []
        return
      }
      const q = new URLSearchParams()
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      const qs = q.toString()
      expenses.value = await $fetch<ApiExpense[]>(`/api/expenses${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      expenses.value = []
    } finally {
      pending.value = false
    }
  }

  return { expenses, pending, error, storeId, from, to, refresh }
}