/** Gastos operativos por sucursal. */
import type { ApiExpense, ApiExpensesPage, ExpenseType } from '~/types/inventario'

export function useExpenses() {
  const expenses = useState<ApiExpense[]>('expenses', () => [])
  const total = useState('expenses-history-total', () => 0)
  const page = useState('expenses-history-page', () => 1)
  const pageSize = useState('expenses-history-pagesize', () => 100)
  const pending = useState('expenses-pending', () => false)
  const error = useState<string | null>('expenses-error', () => null)
  const storeId = useState<number | undefined>('expenses-store', () => undefined)
  const type = useState<ExpenseType | undefined>('expenses-type', () => undefined)   
  const from = useState<string | undefined>('expenses-from', () => undefined)
  const to = useState<string | undefined>('expenses-to', () => undefined)
  const search = useState('expenses-search', () => '')
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
      if (type.value) q.set('type', type.value)   
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
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

  const watching = useState('expenses-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch([storeId, type, from, to, search], () => {   // ← type agregado al watch
      page.value = 1
      void refresh()
    })
    watch(page, () => void refresh())
  }

  return { expenses, total, page, pageSize, pending, error, storeId, type, from, to, search, refresh }
}

// composables/useAllExpenses.ts
/** Todos los gastos del filtro actual, SIN paginar — para agregados (dashboard, reportes). */

export function useAllExpenses() {
  const expenses = useState<ApiExpense[]>('all-expenses', () => [])
  const pending = useState('all-expenses-pending', () => false)
  const error = useState<string | null>('all-expenses-error', () => null)
  const storeId = useState<number | undefined>('all-expenses-store', () => undefined)
  const from = useState<string | undefined>('all-expenses-from', () => undefined)
  const to = useState<string | undefined>('all-expenses-to', () => undefined)
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
      // Sin page/pageSize: así el endpoint NO entra al modo paginado
      // (paginate = query.page != null) y regresa el arreglo completo.
      const qs = q.toString()

      const result = await $fetch<ApiExpense[]>(
        `/api/expenses${qs ? `?${qs}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      // Sin page, el endpoint siempre regresa un arreglo plano (mapped),
      // nunca el objeto { data, total, page, pageSize }.
      expenses.value = Array.isArray(result) ? result : []
    } catch (e) {
      error.value = apiErrorMessage(e)
      expenses.value = []
    } finally {
      pending.value = false
    }
  }

  return { expenses, pending, error, storeId, from, to, refresh }
}