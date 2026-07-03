export interface AverageCostRow {
  productId: number
  storeId: number
  totalQty: number
  avgCost: number
}

export function useAverageCosts() {
  const { data, pending, error, refresh } = useFetch<AverageCostRow[]>(
    '/api/movements/average-cost',
    { default: () => [] }
  )

  return { data, pending, error, refresh }
}