// composables/useAverageCosts.ts
import type { ApiAverageCost } from '~/types/inventario'

/** Costo promedio (FIFO) por producto × sucursal. Endpoint autenticado: requiere Bearer. */
export function useAverageCosts() {
  const averageCosts = useState<ApiAverageCost[]>('average-costs', () => [])
  const pending = useState('average-costs-pending', () => false)
  const error = useState<string | null>('average-costs-error', () => null)
  const storeId = useState<number | undefined>('average-costs-store', () => undefined)
  const user = useSupabaseUser()
  const supabase = useSupabaseClient()

  async function refresh() {
    if (!user.value) {
      averageCosts.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        averageCosts.value = []
        return
      }
      const qs = storeId.value ? `?storeId=${storeId.value}` : ''
      averageCosts.value = await $fetch<ApiAverageCost[]>(`/api/average-costs${qs}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (e) {
      error.value = apiErrorMessage(e)
      averageCosts.value = []
    } finally {
      pending.value = false
    }
  }

  /** Mapa "productId-storeId" → costo promedio, para lookup O(1). */
  const costMap = computed(() => {
    const map = new Map<string, number>()
    for (const item of averageCosts.value) {
      map.set(`${item.productId}-${item.storeId}`, item.avgCost)
    }
    return map
  })

  /** Costo promedio de un producto en una sucursal; 0 si no hay dato. */
  function getAverageCost(productId: number, storeId: number): number {
    return costMap.value.get(`${productId}-${storeId}`) ?? 0
  }

  return { averageCosts, pending, error, storeId, refresh, costMap, getAverageCost }
}