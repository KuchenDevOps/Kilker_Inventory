// ───────────────────────────────────────────────
//  RESUMEN DEL DASHBOARD (1 sola petición)
// ───────────────────────────────────────────────
// Sustituye a las llamadas a /api/sales, /api/movements, /api/expenses,
// /api/average-costs, /api/reports/monthly-inventory y la segunda pasada a
// /api/reports/top-products. Todo se agrega en el servidor.
import type { ApiMonthlyInventory } from '~/types/inventario'

export interface ExpenseBucket {
  subtotal: number
  totalPaid: number
  balance: number
}

export interface DashboardSummary {
  storeId: number | null
  from: string | null
  to: string | null
  /** Compras del periodo (entradas, excluyendo facturas 'II' y anuladas). */
  entriesValue: number
  /** Inventario inicial del periodo (entradas 'II', excluyendo anuladas). */
  startInventoryValue: number
  /** Abonado y saldo de esas mismas compras: suman `entriesValue`. */
  entriesPaid: number
  entriesBalance: number
  /** Ventas emitidas del periodo. */
  salesValue: number
  expenses: Record<'Fijo' | 'Operativo', ExpenseBucket>
  soldTotals: { totalCost: number; totalRevenue: number; totalProfit: number }
  monthly: ApiMonthlyInventory
}

export interface DashboardSummaryParams {
  storeId?: number
  from?: string
  to?: string
  /** YYYY-MM */
  month: string
}

export function useDashboardSummary() {
  const data = useState<DashboardSummary | null>('dashboard-summary', () => null)
  const pending = useState('dashboard-summary-pending', () => false)
  const error = useState<string | null>('dashboard-summary-error', () => null)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  // Descarta respuestas de peticiones que ya quedaron obsoletas porque el
  // usuario cambió el filtro antes de que llegara la anterior.
  let latestRequest = 0

  async function refresh(params: DashboardSummaryParams) {
    if (!user.value) {
      data.value = null
      return
    }

    const requestId = ++latestRequest
    pending.value = true
    error.value = null

    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      if (!token) {
        if (requestId === latestRequest) data.value = null
        return
      }

      const q = new URLSearchParams({ month: params.month })
      if (params.storeId) q.set('storeId', String(params.storeId))
      if (params.from) q.set('from', params.from)
      if (params.to) q.set('to', params.to)

      const result = await $fetch<DashboardSummary>(`/api/dashboard/summary?${q}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (requestId !== latestRequest) return
      data.value = result
    } catch (e) {
      if (requestId !== latestRequest) return
      error.value = apiErrorMessage(e)
      data.value = null
    } finally {
      if (requestId === latestRequest) pending.value = false
    }
  }

  return { data, pending, error, refresh }
}
