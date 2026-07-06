import type { ApiCustomer } from '~/types/inventario'


export function useCustomers() {
  return useFetch<ApiCustomer[]>('/api/customers', {
    key: 'customers',
    default: () => [],
    transform: (v) => v ?? []
  })
}