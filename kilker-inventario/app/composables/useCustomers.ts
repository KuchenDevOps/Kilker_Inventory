import type { ApiCustomer } from '~/types/inventario'

export function useCustomers() {
  const customers = useState<ApiCustomer[]>('customers', () => [])
  const total = useState('customers-total', () => 0)
  const page = useState('customers-page', () => 1)
  const pageSize = useState('customers-pagesize', () => 100)
  const pending = useState('customers-pending', () => false)
  const error = useState<string | null>('customers-error', () => null)

  async function refresh() {
    pending.value = true
    error.value = null
    try {
      const q = new URLSearchParams()
      q.set('page', String(page.value))
      q.set('pageSize', String(pageSize.value))

      const res = await $fetch<{ data: ApiCustomer[]; total: number; page: number; pageSize: number }>(
        `/api/customers?${q.toString()}`
      )
      customers.value = res.data
      total.value = res.total
    } catch (e) {
      error.value = apiErrorMessage(e)
      customers.value = []
    } finally {
      pending.value = false
    }
  }

  const watching = useState('customers-watching', () => false)
  if (import.meta.client && !watching.value) {
    watching.value = true
    watch(page, () => void refresh())
    void refresh()
  }

  return { customers, total, page, pageSize, pending, error, refresh }
}