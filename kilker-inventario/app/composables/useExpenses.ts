/** Gastos operativos por sucursal. */
import type {
  ApiExpense,
  ApiExpensesPage,
  ApiExpensesTotals,
  ExpenseType
} from '~/types/inventario'

/**
 * Sumatorias en cero: estado inicial y reset. Mientras la petición está en
 * vuelo (o falló), la tarjeta muestra $0 en vez de la cifra del filtro
 * anterior, que es peor que no mostrar nada.
 */
const ZERO_EXPENSE_TOTALS: ApiExpensesTotals = {
  issuedCount: 0,
  subtotal: 0,
  iva: 0,
  totalToPay: 0,
  voidedCount: 0,
  voidedSubtotal: 0
}

export function useExpenses() {
  const expenses = useState<ApiExpense[]>('expenses', () => [])
  const total = useState('expenses-history-total', () => 0)
  const totals = useState<ApiExpensesTotals>('expenses-totals', () => ({
    ...ZERO_EXPENSE_TOTALS
  }))
  const page = useState('expenses-history-page', () => 1)
  const pageSize = useState('expenses-history-pagesize', () => 100)
  const pending = useState('expenses-pending', () => false)
  const error = useState<string | null>('expenses-error', () => null)
  const storeId = useState<number | undefined>('expenses-store', () => undefined)
  const type = useState<ExpenseType | undefined>('expenses-type', () => undefined)   
  const from = useState<string | undefined>('expenses-from', () => undefined)
  const to = useState<string | undefined>('expenses-to', () => undefined)
  const search = useState('expenses-search', () => '')
  /** Búsqueda por quién pagó (expense_payments.paid_by). Filtro aparte de `search`. */
  const paidBy = useState('expenses-paid-by', () => '')
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      expenses.value = []
      totals.value = { ...ZERO_EXPENSE_TOTALS }
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        expenses.value = []
        totals.value = { ...ZERO_EXPENSE_TOTALS }
        return
      }
      const q = new URLSearchParams()
      if (storeId.value) q.set('storeId', String(storeId.value))
      if (type.value) q.set('type', type.value)
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      if (paidBy.value.trim()) q.set('paidBy', paidBy.value.trim())
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))
      const qs = q.toString()

      const result = await $fetch<ApiExpense[] | ApiExpensesPage>(
        `/api/expenses${qs ? `?${qs}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      if (Array.isArray(result)) {
        // Sin envolver no hay sumatoria del servidor, y la de la página sería
        // engañosa: cero.
        expenses.value = result
        total.value = result.length
        totals.value = { ...ZERO_EXPENSE_TOTALS }
      } else {
        expenses.value = result.data
        total.value = result.total
        totals.value = result.totals ?? { ...ZERO_EXPENSE_TOTALS }
      }
    } catch (e) {
      error.value = apiErrorMessage(e)
      expenses.value = []
      totals.value = { ...ZERO_EXPENSE_TOTALS }
    } finally {
      pending.value = false
    }
  }

  useSharedScope('expenses', () => {
    // Volver a la página 1 al cambiar un filtro. Si `page` ya cambió, el
    // watcher de abajo hace el fetch; llamar refresh() aquí además lo
    // duplicaría.
    const resetAndRefresh = () => {
      if (page.value !== 1) page.value = 1
      else void refresh()
    }

    watch([storeId, type, from, to], resetAndRefresh)

    // Los dos campos de texto sí se debouncean: sin esto cada tecla dispara
    // una petición (y la de `paidBy` además consulta expense_payments).
    let searchTimeout: ReturnType<typeof setTimeout> | null = null
    watch([search, paidBy], () => {
      if (searchTimeout) clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => {
        searchTimeout = null
        resetAndRefresh()
      }, 300)
    })

    watch(page, () => void refresh())
  })

  return { expenses, total, totals, page, pageSize, pending, error, storeId, type, from, to, search, paidBy, refresh }
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