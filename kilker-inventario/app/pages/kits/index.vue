<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

useHead({ title: 'Kits · Inventario Kilker' })

const { kits, pending, error } = useKits()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const expandedId = ref<number | null>(null)

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN'
})

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return kits.value
  return kits.value.filter(
    (k) =>
      k.sku.toLowerCase().includes(q) ||
      k.name.toLowerCase().includes(q) ||
      // También busca dentro de los productos que componen el kit.
      k.items.some(
        (i) =>
          (i.sku ?? '').toLowerCase().includes(q) ||
          (i.name ?? '').toLowerCase().includes(q)
      )
  )
})

// Paginación client-side sobre el resultado ya filtrado (mismo patrón que /productos).
const page = ref(1)
const pageSize = ref(50)
const total = computed(() => filtered.value.length)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch(search, () => { page.value = 1 })
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Kits de venta</h1>
        <p class="text-sm text-muted">
          {{ total }} kits · productos que los componen y su precio
        </p>
      </div>
      <UButton
        v-if="isAdmin"
        to="/productos/nuevo"
        icon="i-lucide-plus"
        color="primary"
      >
        Nuevo kit
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los kits"
      :description="error"
    />

    <UInput
      v-model="search"
      icon="i-lucide-search"
      placeholder="Buscar por SKU o nombre del kit, o por producto que contiene…"
      class="w-full sm:max-w-md"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">SKU</th>
              <th class="px-4 py-3 font-medium">Kit</th>
              <th class="px-4 py-3 font-medium text-right">Productos</th>
              <th class="px-4 py-3 font-medium text-right">Precio del kit</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Detalle</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="7" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!paged.length">
              <td colspan="7" class="px-4 py-8 text-center text-muted">
                {{ search ? 'Sin resultados.' : 'Todavía no hay kits registrados.' }}
              </td>
            </tr>
            <template v-else>
              <template v-for="k in paged" :key="k.id">
                <tr class="hover:bg-elevated/50">
                  <td class="px-4 py-3 font-mono text-xs">{{ k.sku }}</td>
                  <td class="px-4 py-3 font-medium">{{ k.name }}</td>
                  <td class="px-4 py-3 text-right tabular-nums">{{ k.itemCount }}</td>
  
                  <td class="px-4 py-3 text-right tabular-nums">
                    <p class="font-medium">{{ currency.format(k.totalPrice) }}</p>
                    
                  </td>
                  <td class="px-4 py-3 text-center">
                    <UBadge
                      :label="k.isActive ? 'Activo' : 'Inactivo'"
                      :color="k.isActive ? 'success' : 'neutral'"
                      variant="subtle"
                    />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <UButton
                      size="xs"
                      :color="expandedId === k.id ? 'primary' : 'neutral'"
                      variant="ghost"
                      :icon="expandedId === k.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                      @click="expandedId = expandedId === k.id ? null : k.id"
                    />
                  </td>
                </tr>

                <tr v-if="expandedId === k.id">
                  <td colspan="7" class="p-0 bg-elevated/40">
                    <table class="w-full text-sm">
                      <thead class="text-muted border-y border-default">
                        <tr class="text-left">
                          <th class="px-8 py-2 font-medium">SKU</th>
                          <th class="px-4 py-2 font-medium">Producto</th>
                          <th class="px-4 py-2 font-medium">Unidad</th>
                          <th class="px-4 py-2 font-medium text-right">Cantidad</th>
                          <th class="px-4 py-2 font-medium text-right">Precio de catálogo</th>
                          <th class="px-4 py-2 font-medium text-right">Precio en el kit</th>
                          <th class="px-4 py-2 font-medium text-right">Importe</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-default">
                        <tr v-if="!k.items.length">
                          <td colspan="7" class="px-8 py-3 text-muted">
                            Este kit no tiene productos.
                          </td>
                        </tr>
                        <tr v-for="it in k.items" :key="it.id">
                          <td class="px-8 py-3 font-mono text-xs">{{ it.sku ?? '—' }}</td>
                          <td class="px-4 py-3">
                            {{ it.name ?? `Producto ${it.productId}` }}
                            <UBadge
                              v-if="!it.productIsActive"
                              label="Inactivo"
                              color="warning"
                              variant="subtle"
                              size="xs"
                              class="ml-2"
                            />
                          </td>
                          <td class="px-4 py-3 text-muted">
                            {{ it.unit ? UNIT_LABELS[it.unit] : '—' }}
                          </td>
                          <td class="px-4 py-3 text-right tabular-nums">{{ it.quantity }}</td>
                          <td class="px-4 py-3 text-right tabular-nums text-muted">
                            {{ currency.format(it.listUnitPrice) }}
                          </td>
                          <td class="px-4 py-3 text-right tabular-nums">
                            {{ currency.format(it.unitPrice) }}
                           
                          </td>
                          <td class="px-4 py-3 text-right tabular-nums">
                            {{ currency.format(it.lineTotal) }}
                          </td>
                        </tr>
                      </tbody>
                      <tfoot class="border-t border-default">
                        <tr>
                          <td colspan="6" class="px-4 py-3 text-right font-medium">
                            Total del kit
                          </td>
                          <td class="px-4 py-3 text-right tabular-nums font-semibold">
                            {{ currency.format(k.totalPrice) }}
                          </td>
                        </tr>
                      </tfoot>
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
      <p class="text-xs text-muted">Mostrando {{ paged.length }} de {{ total }} kits</p>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>
  </UContainer>
</template>
