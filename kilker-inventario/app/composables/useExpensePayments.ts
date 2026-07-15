import type { ApiExpensePayment } from '~/types/inventario'


export function useExpensePayments(expenseId: Ref<number | null>) {
  const payments = ref<ApiExpensePayment[]>([])
  const pending = ref(false)
  const error = ref<string | null>(null)
  const apiFetch = useApiFetch()

  async function refresh() {
    if (expenseId.value == null) {
      payments.value = []
      return
    }
    pending.value = true
    error.value = null
    try {
      payments.value = await apiFetch<ApiExpensePayment[]>(`/api/expenses/${expenseId.value}/payments`)
    } catch (e) {
      error.value = apiErrorMessage(e)
      payments.value = []
    } finally {
      pending.value = false
    }
  }

  return { payments, pending, error, refresh }
}