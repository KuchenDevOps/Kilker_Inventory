import type { ApiExpense, ApiExpensesPage } from '~/types/inventario'

/** Gastos operativos por sucursal. */
export function useExpenses() {
  const expenses = useState<ApiExpense[]>('expenses', () => [])
  const total = useState('expenses-history-total', () => 0)
  const page = useState('expenses-history-page', () => 1)
  const pageSize = useState('expenses-history-pagesize', () => 100)
  const pending = useState('expenses-pending', () => false)
  const error = useState<string | null>('expenses-error', () => null)
  const storeId = useState<number | undefined>('expenses-store', () => undefined)
  const from = useState<string | undefined>('expenses-from', () => undefined)
  const to = useState<string | undefined>('expenses-to', () => undefined)
  const search = useState('expenses-search', () => '')   // ← NUEVO
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
      if (search.value.trim()) q.set('q', search.value.trim())   // ← NUEVO
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))
      const qs = q.toString()

      const result = await $fetch<ApiExpense[] | ApiExpensesPage>(
        `/api/expenses${qs ? `?${qs}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      if (Array.isArray(result)) {
        expenses.value = result
        total.value = result.length
      } else {
        expenses.value = result.data
        total.value = result.total
      }
    } catch (e) {
      error.value = apiErrorMessage(e)
      expenses.value = []
    } finally {
      pending.value = false
    }
  }

  // ─── NUEVO: reset a página 1 cuando cambian los filtros ───
  const watching = useState('expenses-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch([storeId, from, to, search], () => {
      page.value = 1
      void refresh()
    })
    watch(page, () => void refresh())
  }
  // ─── fin del bloque nuevo ───

  return { expenses, total, page, pageSize, pending, error, storeId, from, to, search, refresh }
}