// ───────────────────────────────────────────────
//  LIBRO DE DINERO (banks_movements)
// ───────────────────────────────────────────────
// Alimenta /cuentas/movimientos. Mismo patrón que `useExpenses`: filtros en
// `useState` compartido, watchers instalados una sola vez (`useSharedScope`) y
// Bearer tomado de la sesión viva de Supabase (ver §7 de CLAUDE.md: con este
// setup la cookie no resuelve el usuario en el servidor).
import type { ApiBanksMovement, ApiBanksMovementsPage, ApiCashFlowBalance, CashFlowType } from '~/types/inventario'
import { SUGGESTED_CASH_FLOW_CONCEPTS } from '~/types/inventario'

export function useBanksMovements() {
  const movements = useState<ApiBanksMovement[]>('banks-movements', () => [])
  const balances = useState<ApiCashFlowBalance[]>('banks-movements-balances', () => [])
  /** Conceptos ya usados, para sugerirlos al capturar uno nuevo. */
  const concepts = useState<string[]>('banks-movements-concepts', () => [])
  /** Clasificaciones presentes en el libro (no el enum completo), para el filtro. */
  const types = useState<CashFlowType[]>('banks-movements-types', () => [])
  const globalBalance = useState('banks-movements-global', () => 0)
  const filteredNet = useState('banks-movements-net', () => 0)
  const total = useState('banks-movements-total', () => 0)
  const page = useState('banks-movements-page', () => 1)
  // 100 por página, como el resto de los listados (el endpoint admite hasta 200).
  const pageSize = useState('banks-movements-pagesize', () => 100)
  const pending = useState('banks-movements-pending', () => false)
  const error = useState<string | null>('banks-movements-error', () => null)

  /** '' = todas las bolsas · 'cash' = efectivo · '12' = esa cuenta. */
  const account = useState('banks-movements-account', () => '')
  const type = useState<CashFlowType | undefined>('banks-movements-type', () => undefined)
  /** '' = todo · 'manual' = capturados a mano · 'documento' = cobros y pagos. */
  const source = useState('banks-movements-source', () => '')
  const from = useState<string | undefined>('banks-movements-from', () => undefined)
  const to = useState<string | undefined>('banks-movements-to', () => undefined)
  const search = useState('banks-movements-search', () => '')

  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      movements.value = []
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
      if (account.value) q.set('account', account.value)
      if (type.value) q.set('type', type.value)
      if (source.value) q.set('source', source.value)
      if (from.value) q.set('from', from.value)
      if (to.value) q.set('to', to.value)
      if (search.value.trim()) q.set('q', search.value.trim())
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      // Siempre envuelto, con o sin `?page`: el endpoint no devuelve arreglo
      // pelón en ningún caso (ver su encabezado).
      const result = await $fetch<ApiBanksMovementsPage>(`/api/banks-movements?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      movements.value = result.data
      total.value = result.total
      balances.value = result.balances
      concepts.value = result.concepts
      types.value = result.types
      globalBalance.value = result.globalBalance
      filteredNet.value = result.filteredNet
    } catch (e) {
      error.value = apiErrorMessage(e)
      movements.value = []
    } finally {
      pending.value = false
    }
  }

  useSharedScope('banks-movements', () => {
    // Cambiar un filtro vuelve a la página 1. Si `page` ya cambió, el watcher de
    // abajo dispara el fetch; llamar refresh() aquí además lo duplicaría.
    const resetAndRefresh = () => {
      if (page.value !== 1) page.value = 1
      else void refresh()
    }

    watch([account, type, source, from, to], resetAndRefresh)

    // La búsqueda sí se debouncea: sin esto cada tecla es una petición.
    let searchTimeout: ReturnType<typeof setTimeout> | null = null
    watch(search, () => {
      if (searchTimeout) clearTimeout(searchTimeout)
      searchTimeout = setTimeout(() => {
        searchTimeout = null
        resetAndRefresh()
      }, 300)
    })

    watch(page, () => void refresh())
    // `immediate` para la primera carga; el watcher de `user` además recarga al
    // volver a entrar (el layout se desmonta al ir a /login).
    watch(user, () => void refresh(), { immediate: true })
  })

  return {
    movements,
    balances,
    concepts,
    types,
    globalBalance,
    filteredNet,
    total,
    page,
    pageSize,
    pending,
    error,
    account,
    type,
    source,
    from,
    to,
    search,
    refresh
  }
}

/**
 * Totales del libro de dinero, para tarjetas de dashboard.
 *
 * ⚠️ NO reutiliza `useBanksMovements`: sus filtros viven en `useState` global y
 * compartirlos haría que abrir el dashboard le cambiara los filtros a
 * /cuentas/movimientos (y al revés). Este composable solo lee, no filtra, y
 * tiene su propio estado.
 *
 * Una sola petición basta para las dos cifras: el endpoint devuelve
 * `globalBalance` sobre TODO el libro (ignora los filtros, a propósito) y
 * `filteredNet` sobre lo filtrado — aquí, el concepto pedido.
 *
 * ⚠️ Los dos totales son HISTÓRICOS, sin periodo. Un saldo recortado a un rango
 * no es un saldo: es el neto de ese rango, y para un "saldo inicial" no
 * significaría nada. Si algún día se filtran por periodo, hay que renombrar las
 * tarjetas.
 */
export function useCashFlowTotals(concept: string = SUGGESTED_CASH_FLOW_CONCEPTS[0]) {
  const globalBalance = useState('cash-flow-totals-global', () => 0)
  const conceptTotal = useState('cash-flow-totals-concept', () => 0)
  const pending = useState('cash-flow-totals-pending', () => false)
  const error = useState<string | null>('cash-flow-totals-error', () => null)

  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) return
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return

      // `pageSize=1`: solo interesan los agregados, no las filas.
      const q = new URLSearchParams({ concept, page: '1', pageSize: '1' })
      const result = await $fetch<ApiBanksMovementsPage>(`/api/banks-movements?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      globalBalance.value = result.globalBalance
      conceptTotal.value = result.filteredNet
    } catch (e) {
      // El libro de dinero es solo para admin y observador: para el resto esto
      // es un 403 esperado, no una falla. Se deja el error a la vista de la
      // página, que decide si mostrarlo o esconder las tarjetas.
      error.value = apiErrorMessage(e)
      globalBalance.value = 0
      conceptTotal.value = 0
    } finally {
      pending.value = false
    }
  }

  useSharedScope('cash-flow-totals', () => {
    watch(user, () => void refresh(), { immediate: true })
  })

  return { globalBalance, conceptTotal, pending, error, refresh }
}
