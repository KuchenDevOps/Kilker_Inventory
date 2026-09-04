// ───────────────────────────────────────────────
//  RESUMEN DEL DASHBOARD (1 sola petición)
// ───────────────────────────────────────────────
// Sustituye a las llamadas a /api/sales, /api/movements, /api/expenses,
// /api/average-costs, /api/reports/monthly-inventory y la segunda pasada a
// /api/reports/top-products. Todo se agrega en el servidor.
import type { ApiMonthlyInventory } from '~/types/inventario'

export interface ExpenseBucket {
  /**
   * Suma de `expenses.amount`. Es el GASTO DEL NEGOCIO, no lo que se desembolsa:
   * el IVA se paga pero se entera al SAT, así que no es gasto propio.
   */
  subtotal: number
  /** IVA de esos gastos (`expenses.iva`, columna generada). */
  iva: number
  /**
   * ⚠️ Lo que REALMENTE se paga: `subtotal + IVA − retenciones`
   * (`expenses.total_to_pay`, columna generada por Postgres).
   *
   * `totalPaid` y `balance` se miden contra ESTE número, no contra `subtotal`.
   * No lo recalcules en el cliente: la fórmula escrita a mano en el dashboard y
   * la del endpoint de abonos ya divergieron una vez y por ahí entraron pagos
   * inflados. Hay una sola definición y vive en la base.
   */
  totalToPay: number
  totalPaid: number
  balance: number
  /**
   * Retenciones capturadas en los gastos del periodo. YA NO son informativas:
   * se restan de `totalToPay` porque no se le pagan al proveedor, se le retienen
   * para enterarlas al SAT. Vienen desglosadas por si se quieren mostrar.
   */
  retentionIva: number
  retentionIsr: number
}

export interface DashboardSummary {
  storeId: number | null
  from: string | null
  to: string | null
  /** Compras del periodo (entradas, excluyendo facturas 'II' y anuladas). */
  entriesValue: number
  /** Abonado y saldo de esas mismas compras: suman `entriesValue`. */
  entriesPaid: number
  entriesBalance: number
  /**
   * Ventas emitidas del periodo, en SUBTOTAL (sin IVA): el ingreso del negocio.
   * El IVA cobrado se entera al SAT, así que no entra aquí.
   */
  salesValue: number
  /** IVA de esas ventas (`invoices.iva`, columna generada). */
  salesIva: number
  /** Lo facturado al cliente: `salesValue + salesIva`. Es lo que se cobra. */
  salesTotalToPay: number
  /**
   * Cobrado y por cobrar de esas mismas ventas: suman `salesTotalToPay`, NO
   * `salesValue` — desde que el IVA de ventas dejó de ser informativo, el
   * cobrable es `invoices.total_to_pay`.
   *
   * ⚠️ Es dinero de la CARTERA, no del banco. Lo que mueve el saldo bancario es
   * el abono cuando entra, y una venta a crédito no mueve un peso hasta que se
   * cobra: por eso `salesPaid` del periodo no tiene por qué coincidir con los
   * cobros asentados en `banks_movements` (un abono de hoy puede cobrar una
   * factura de hace tres meses).
   */
  salesPaid: number
  salesBalance: number
  expenses: Record<'Fijo' | 'Operativo', ExpenseBucket>
  soldTotals: {
    totalCost: number
    totalRevenue: number
    totalProfit: number
    /**
     * Unidades vendidas que salieron contra una capa de costo $0 (la entrada
     * que las trajo se capturó sin costo) y el ingreso que generaron.
     * `totalCost` está subvaluado en lo que de verdad valían, y `totalProfit`
     * inflado en lo mismo. Alimenta el aviso de la tarjeta "Costo total".
     */
    zeroCostUnits: number
    zeroCostRevenue: number
  }
  /**
   * ⚠️ El inventario de APERTURA del periodo vive aquí, en
   * `monthly.openingInventoryValue`: el valor FIFO de las capas justo antes de
   * `from`, que es el mismo con el que cuadra la conciliación. Hubo un
   * `startInventoryValue` al lado de `entriesValue` (suma de entradas con
   * factura 'II') que se quitó porque era un total de toda la historia:
   * ignoraba el periodo y la sucursal elegidos, y no cuadraba con nada.
   */
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
