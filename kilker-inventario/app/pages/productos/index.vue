<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'
import * as XLSX from 'xlsx'

useHead({ title: 'Catálogo · Inventario Kilker' })

const { products, pending, error, refresh } = useAllProducts()
const { data: stores } = useStores()
const storeMap = computed(() => new Map(stores.value.map((s) => [s.id, s])))
const expandedId = ref<number | null>(null)
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const toast = useToast()
const apiFetch = useApiFetch()
const confirmingDeleteId = ref<number | null>(null)
const deleting = ref(false)

async function deleteProduct(id: number) {
  deleting.value = true
  try {
    await apiFetch(`/api/products/${id}`, { method: 'DELETE' })
    await refresh()
    toast.add({
      title: 'Producto borrado',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    confirmingDeleteId.value = null
  } catch (e) {
    toast.add({
      title: 'No se pudo borrar el producto',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    deleting.value = false
  }
}

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN'
})

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return products.value
  return products.value.filter(
    (p) =>
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q) ||
      (p.color ?? '').toLowerCase().includes(q)
  )
})

// Paginación client-side sobre el resultado ya filtrado.
const page = ref(1)
const pageSize = ref(100)
const total = computed(() => filtered.value.length)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

// Si cambia la búsqueda, vuelve a la página 1 (si no, puedes quedar en una página vacía).
watch(search, () => { page.value = 1 })

interface InventoryValueByStore { storeId: number; endingUnits: number; endingValue: number }
interface InventoryValueResult {
  productId: number
  byStore: InventoryValueByStore[]
  totalEndingUnits: number
  totalEndingValue: number
}

const inventoryValueCache = ref<Record<number, InventoryValueResult | 'loading' | 'error'>>({})

async function loadInventoryValue(productId: number) {
  if (inventoryValueCache.value[productId]) return // ya cargado o cargando
  inventoryValueCache.value[productId] = 'loading'
  try {
    const result = await apiFetch<InventoryValueResult>(`/api/products/${productId}/inventory-value`)
    inventoryValueCache.value[productId] = result
  } catch {
    inventoryValueCache.value[productId] = 'error'
  }
}

watch(expandedId, (id) => {
  if (id != null) loadInventoryValue(id)
})

const exportingInventoryValue = ref(false)

async function exportInventoryValue() {
  exportingInventoryValue.value = true
  try {
    const rows = await apiFetch<Array<{ productId: number; storeId: number; endingUnits: number; endingValue: number }>>(
      '/api/reports/inventory-value'
    )
    if (!rows.length) {
      toast.add({ title: 'Sin inventario para exportar', color: 'warning', icon: 'i-lucide-info' })
      return
    }

    const productMap = new Map(products.value.map((p) => [p.id, p]))

    // Agrupar por sucursal, ordenando cada grupo por valor descendente.
    const rowsByStore = new Map<number, typeof rows>()
    for (const r of rows) {
      if (!rowsByStore.has(r.storeId)) rowsByStore.set(r.storeId, [])
      rowsByStore.get(r.storeId)!.push(r)
    }

    // Orden de sucursales: por código, para que el Excel salga consistente
    // entre exportaciones (no depende del orden en que llegó del API).
    const storeIdsSorted = [...rowsByStore.keys()].sort((a, b) => {
      const codeA = storeMap.value.get(a)?.code ?? ''
      const codeB = storeMap.value.get(b)?.code ?? ''
      return codeA.localeCompare(codeB)
    })

    type SheetRow = {
      SKU: string
      Producto: string
      Categoría: string
      Sucursal: string
      Existencia: number
      'Valor de inventario': number
    }
    const sheetRows: SheetRow[] = []

    let grandTotalUnits = 0
    let grandTotalValue = 0

    for (const storeId of storeIdsSorted) {
      const store = storeMap.value.get(storeId)
      const storeLabel = store ? `${store.code} · ${store.name}` : `Sucursal ${storeId}`
      const storeRows = rowsByStore.get(storeId)!.sort((a, b) => b.endingValue - a.endingValue)

      let storeTotalUnits = 0
      let storeTotalValue = 0

      for (const r of storeRows) {
        const product = productMap.get(r.productId)
        sheetRows.push({
          SKU: product?.sku ?? '',
          Producto: product?.name ?? `Producto ${r.productId}`,
          Categoría: product?.category ?? '',
          Sucursal: storeLabel,
          Existencia: r.endingUnits,
          'Valor de inventario': r.endingValue
        })
        storeTotalUnits += r.endingUnits
        storeTotalValue += r.endingValue
      }

      // Subtotal de la sucursal.
      sheetRows.push({
        SKU: '',
        Producto: '',
        Categoría: '',
        Sucursal: `Subtotal ${storeLabel}`,
        Existencia: Math.round(storeTotalUnits * 1000) / 1000,
        'Valor de inventario': Math.round(storeTotalValue * 100) / 100
      })

      // Fila en blanco como separador visual entre sucursales.
      sheetRows.push({ SKU: '', Producto: '', Categoría: '', Sucursal: '', Existencia: null, 'Valor de inventario': null })

      grandTotalUnits += storeTotalUnits
      grandTotalValue += storeTotalValue
    }

    // Quita el separador en blanco final antes del total general.
    sheetRows.pop()

    sheetRows.push({
      SKU: '',
      Producto: '',
      Categoría: '',
      Sucursal: 'TOTAL GENERAL',
      Existencia: Math.round(grandTotalUnits * 1000) / 1000,
      'Valor de inventario': Math.round(grandTotalValue * 100) / 100
    })

    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(sheetRows)
    sheet['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(workbook, sheet, 'Inventario valorizado')

    const fecha = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(workbook, `inventario-valorizado_${fecha}.xlsx`)
  } catch (e) {
    toast.add({
      title: 'No se pudo exportar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    exportingInventoryValue.value = false
  }
}

</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Catálogo</h1>
        <p class="text-sm text-muted">
          {{ total }} productos · existencias
        </p>
      </div>
       <div v-if="isAdmin" class="flex items-center gap-2">
    <UButton
      to="/productos/nuevo"
      icon="i-lucide-plus"
      color="primary"
    >
      Nuevo producto
    </UButton>

    <UButton
      icon="i-lucide-file-spreadsheet"
      color="neutral"
      variant="subtle"
      :loading="exportingInventoryValue"
      @click="exportInventoryValue"
    >
      Exportar valor de inventario
    </UButton>
  </div>

    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los productos"
      :description="error"
    />

    <UInput
      v-model="search"
      icon="i-lucide-search"
      placeholder="Buscar por SKU, nombre, categoría o color…"
      class="w-full sm:max-w-sm"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">SKU</th>
              <th class="px-4 py-3 font-medium">Producto</th>
              <th class="px-4 py-3 font-medium">Categoría</th>
              <th class="px-4 py-3 font-medium">Unidad</th>
              <th class="px-4 py-3 font-medium text-right">Precio</th>
              <th class="px-4 py-3 font-medium text-right">Existencia</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="8" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!paged.length">
              <td colspan="8" class="px-4 py-8 text-center text-muted">
                Sin resultados.
              </td>
            </tr>
            <template v-else>
              <template v-for="p in paged" :key="p.id">
                <tr class="hover:bg-elevated/50">
                  <td class="px-4 py-3 font-mono text-xs">{{ p.sku }}</td>
                  <td class="px-4 py-3">
                    <p class="font-medium">{{ p.name }}</p>
                    <p v-if="p.color" class="text-xs text-muted">{{ p.color }}</p>
                  </td>
                  <td class="px-4 py-3 text-muted">{{ p.category ?? '—' }}</td>
                  <td class="px-4 py-3 text-muted">{{ UNIT_LABELS[p.unit] }}</td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ currency.format(Number(p.price)) }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">{{ p.totalStock }}</td>
                  <td class="px-4 py-3 text-center">
                    <UBadge
                      :label="p.isActive ? 'Activo' : 'Inactivo'"
                      :color="p.isActive ? 'success' : 'neutral'"
                      variant="subtle"
                    />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-1">
                      <template v-if="confirmingDeleteId === p.id">
                        <span class="text-xs text-muted mr-1">¿Borrar?</span>
                        <UButton
                          size="xs"
                          color="error"
                          variant="soft"
                          icon="i-lucide-check"
                          :loading="deleting"
                          @click="deleteProduct(p.id)"
                        />
                        <UButton
                          size="xs"
                          color="neutral"
                          variant="ghost"
                          icon="i-lucide-x"
                          :disabled="deleting"
                          @click="confirmingDeleteId = null"
                        />
                      </template>
                      <template v-else>
                        <template v-if="isAdmin">
                          <UButton
                            :to="`/productos/${p.id}/editar`"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-pencil"
                          />
                          <UButton
                            size="xs"
                            color="error"
                            variant="ghost"
                            icon="i-lucide-trash-2"
                            @click="confirmingDeleteId = p.id"
                          />
                        </template>
                        <UButton
                          size="xs"
                          :color="expandedId === p.id ? 'primary' : 'neutral'"
                          variant="ghost"
                          icon="i-lucide-store"
                          @click="expandedId = expandedId === p.id ? null : p.id"
                        />
                      </template>
                    </div>
                  </td>
                </tr>
                <tr v-if="expandedId === p.id">
                  <td colspan="8" class="p-0 bg-elevated/40">
                    <table class="w-full text-sm">
                      <thead class="text-muted border-y border-default">
                        <tr class="text-left">
                          <th class="px-8 py-2 font-medium">Código</th>
                          <th class="px-4 py-2 font-medium">Sucursal</th>
                          <th class="px-4 py-2 font-medium text-right">Existencia</th>
                        </tr>
                      </thead>
                     <tbody class="divide-y divide-default">
                        <tr v-if="!p.byStore.length">
                          <td colspan="4" class="px-8 py-3 text-muted">Sin existencias registradas.</td>
                        </tr>
                        <tr v-for="b in p.byStore" :key="b.storeId">
                          <td class="px-8 py-3 font-mono text-xs">{{ storeMap.get(b.storeId)?.code ?? '?' }}</td>
                          <td class="px-4 py-3 text-muted">{{ storeMap.get(b.storeId)?.name ?? `Sucursal ${b.storeId}` }}</td>
                          <td class="px-4 py-3 text-right tabular-nums">{{ b.quantity }}</td>
                          <td class="px-4 py-3 text-right tabular-nums">
                            <template v-if="inventoryValueCache[p.id] === 'loading'">
                              <USkeleton class="h-4 w-16 ml-auto" />
                            </template>
                            <template v-else-if="inventoryValueCache[p.id] === 'error'">
                              <span class="text-xs text-error">Error</span>
                            </template>
                            <template v-else>
                              {{ currency.format(
                                (inventoryValueCache[p.id] as InventoryValueResult)?.byStore.find((s) => s.storeId === b.storeId)?.endingValue ?? 0
                              ) }}
                            </template>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </div>
    </UCard>

    <div class="flex flex-col items-center gap-2">
      <p class="text-xs text-muted">Mostrando {{ paged.length }} de {{ total }} productos</p>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>
  </UContainer>
</template>