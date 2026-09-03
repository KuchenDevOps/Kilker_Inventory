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

export interface CashFlowTotalsParams {
  from?: string
  /** EXCLUSIVO, igual que en gastos y en la valuación de inventario. */
  to?: string
}

/** `pageSize=1`: de estas peticiones solo interesan los agregados, no las filas. */
function fetchCashFlowTotals(q: URLSearchParams, token: string) {
  q.set('page', '1')
  q.set('pageSize', '1')
  return $fetch<ApiBanksMovementsPage>(`/api/banks-movements?${q}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
}

/**
 * Totales del libro de dinero, para tarjetas de dashboard.
 *
 * ⚠️ NO reutiliza `useBanksMovements`: sus filtros viven en `useState` global y
 * compartirlos haría que abrir el dashboard le cambiara los filtros a
 * /cuentas/movimientos (y al revés). Este composable tiene su propio estado y
 * recibe el periodo por parámetro; no lo lee de ningún lado.
 *
 * Devuelve tres cifras, y la distinción entre ellas es el punto:
 * - **`periodNet`** — neto de lo que se movió DENTRO del periodo. No es un
 *   saldo: es cuánto cambió el dinero en esa ventana.
 * - **`openingBalance`** — el saldo con el que ARRANCA el periodo, mismo papel
 *   que el "Inventario inicial" del dashboard de resultados: todo lo asentado
 *   antes de `from` (`to` es exclusivo, así que `to = from` deja fuera el propio
 *   día de arranque). Sin periodo no hay "antes" que acumular, y entonces cae en
 *   los movimientos del concepto «Saldo inicial» — la carga con la que nació el
 *   libro. `openingIsConcept` dice cuál de las dos cosas se está mostrando, para
 *   que la tarjeta no rotule mal.
 * - **`globalBalance`** — el saldo real de todas las bolsas, histórico completo.
 *   El endpoint lo calcula ignorando los filtros a propósito (ver su encabezado).
 *
 * Con eso, `openingBalance + periodNet` = saldo al cierre del periodo.
 *
 * ⚠️ **Nada de esto se acota por sucursal, ni debe.** El saldo vive por CUENTA
 * BANCARIA y una cuenta no pertenece a ninguna sucursal (`store_id` en
 * `banks_movements` es procedencia informativa). Filtrar por tienda daría un
 * número que no es el saldo de nada.
 */
export function useCashFlowTotals(concept: string = SUGGESTED_CASH_FLOW_CONCEPTS[0]) {
  const globalBalance = useState('cash-flow-totals-global', () => 0)
  const periodNet = useState('cash-flow-totals-period', () => 0)
  const openingBalance = useState('cash-flow-totals-opening', () => 0)
  /** `openingBalance` son los movimientos del concepto, no un acumulado. */
  const openingIsConcept = useState('cash-flow-totals-opening-is-concept', () => true)
  const pending = useState('cash-flow-totals-pending', () => false)
  const error = useState<string | null>('cash-flow-totals-error', () => null)

  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  // Descarta respuestas que ya quedaron obsoletas porque el usuario cambió el
  // periodo antes de que llegara la anterior (mismo guard que useDashboardSummary).
  let latestRequest = 0

  async function refresh(params: CashFlowTotalsParams = {}) {
    if (!user.value) return

    const requestId = ++latestRequest
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return

      const periodQuery = new URLSearchParams()
      if (params.from) periodQuery.set('from', params.from)
      if (params.to) periodQuery.set('to', params.to)

      const openingQuery = new URLSearchParams()
      if (params.from) openingQuery.set('to', params.from)
      else openingQuery.set('concept', concept)

      // Las dos en paralelo: son la misma pantalla, no tiene sentido encadenarlas.
      const [periodResult, openingResult] = await Promise.all([
        fetchCashFlowTotals(periodQuery, token),
        fetchCashFlowTotals(openingQuery, token)
      ])

      if (requestId !== latestRequest) return
      // `globalBalance` viene igual en las dos: el endpoint no lo filtra nunca.
      globalBalance.value = periodResult.globalBalance
      periodNet.value = periodResult.filteredNet
      openingBalance.value = openingResult.filteredNet
      openingIsConcept.value = !params.from
    } catch (e) {
      if (requestId !== latestRequest) return
      // El libro de dinero es solo para admin y observador: para el resto esto
      // es un 403 esperado, no una falla. Se deja el error a la vista de la
      // página, que decide si mostrarlo o esconder las tarjetas.
      error.value = apiErrorMessage(e)
      globalBalance.value = 0
      periodNet.value = 0
      openingBalance.value = 0
    } finally {
      if (requestId === latestRequest) pending.value = false
    }
  }

  return { globalBalance, periodNet, openingBalance, openingIsConcept, pending, error, refresh }
}
