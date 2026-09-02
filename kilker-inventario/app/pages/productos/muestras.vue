<script setup lang="ts">
import type { ApiProduct } from '~/types/inventario'

// Las muestras NO se listan en /productos a propósito: no tienen existencias
// propias (comparten las del producto base) y ensuciarían el valor de
// inventario. Esta es su pantalla: la única donde se ven y se administran.
useHead({ title: 'Muestras · Inventario Kilker' })

const { products, pending, error, refresh } = useSellableProducts()
const { canManageCatalog } = useMe()
const toast = useToast()
const apiFetch = useApiFetch()

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN'
})

/**
 * Solo las muestras. `useSellableProducts()` pide `?samples=include` porque lo
 * comparte con el picker de venta; aquí se queda con la mitad que interesa.
 */
const samples = computed(() => products.value.filter((p) => p.sampleOfProductId != null))

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return samples.value
  return samples.value.filter(
    (s) =>
      s.sku.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      // También por el producto base: es como el vendedor la tiene en la cabeza.
      (s.baseSku ?? '').toLowerCase().includes(q) ||
      (s.baseName ?? '').toLowerCase().includes(q)
  )
})

// Paginación client-side sobre el resultado ya filtrado (mismo patrón que el
// catálogo): hay a lo más una muestra por producto, pero pueden ser cientos.
const page = ref(1)
const pageSize = ref(100)
const total = computed(() => filtered.value.length)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch(search, () => { page.value = 1 })

/**
 * El precio 0 no es una convención de la app: lo garantiza el constraint
 * `products_sample_price_zero` en la base. Se verifica igual para que la
 * pantalla lo CONFIRME en vez de darlo por hecho — si alguna vez saliera un
 * precio distinto, aquí se vería en rojo en vez de pasar desapercibido.
 */
const withNonZeroPrice = computed(() => filtered.value.filter((s) => Number(s.price) !== 0))

const togglingId = ref<number | null>(null)

/** Activa/desactiva una muestra. No toca al producto base. */
async function toggleSample(sample: ApiProduct) {
  togglingId.value = sample.id
  try {
    await apiFetch(`/api/products/${sample.id}`, {
      method: 'PATCH',
      body: { isActive: !sample.isActive }
    })
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo actualizar la muestra',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    togglingId.value = null
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Muestras</h1>
        <p class="text-sm text-muted">
          {{ total }} {{ total === 1 ? 'muestra' : 'muestras' }} · siempre a
          {{ currency.format(0) }}
        </p>
      </div>

      <UButton
        v-if="canManageCatalog"
        to="/productos/nuevo?tipo=muestra"
        icon="i-lucide-plus"
        color="primary"
      >
        Nueva muestra
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar las muestras"
      :description="error"
    />

    <!-- Imposible por el constraint de la base; si aparece, es que alguien tocó
         el esquema a mano en Supabase (ver regla 4 de CLAUDE.md). -->
    <UAlert
      v-if="withNonZeroPrice.length"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="Hay muestras con precio distinto de cero"
      :description="`${withNonZeroPrice.length} muestra(s) no están en $0. Revísalas: una muestra debe entregarse siempre sin costo para el cliente.`"
    />

    <div class="flex flex-wrap items-center gap-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Buscar por SKU o nombre…"
        class="w-full sm:max-w-sm"
      />
      <BotonLimpiarFiltros :active="!!search.trim()" label="Limpiar" @clear="search = ''" />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">SKU</th>
              <th class="px-4 py-3 font-medium">Muestra</th>
              <th class="px-4 py-3 font-medium">Producto base</th>
              <th class="px-4 py-3 font-medium text-right">Precio de venta</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="5" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!paged.length">
              <td colspan="5" class="px-4 py-8 text-center text-muted">
                {{ search ? 'Sin resultados.' : 'Todavía no hay muestras registradas.' }}
              </td>
            </tr>
            <tr v-for="s in paged" v-else :key="s.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 font-mono text-xs">{{ s.sku }}</td>
              <td class="px-4 py-3 font-medium">{{ s.name }}</td>
              <td class="px-4 py-3 text-muted">
                <span class="font-mono text-xs">{{ s.baseSku ?? '—' }}</span>
                <span v-if="s.baseName"> · {{ s.baseName }}</span>
              </td>
              <td
                class="px-4 py-3 text-right tabular-nums"
                :class="Number(s.price) === 0 ? '' : 'text-error font-semibold'"
              >
                {{ currency.format(Number(s.price)) }}
              </td>
              <td class="px-4 py-3 text-center">
                <UButton
                  size="xs"
                  :color="s.isActive ? 'success' : 'neutral'"
                  variant="soft"
                  :loading="togglingId === s.id"
                  :disabled="!canManageCatalog"
                  @click="toggleSample(s)"
                >
                  {{ s.isActive ? 'Activa' : 'Inactiva' }}
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <div v-if="total > pageSize" class="flex justify-end">
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>

    <p class="text-xs text-muted">
      Una muestra comparte el inventario de su producto base: al entregarla se
      descuenta una unidad de ese producto. Por eso aquí no se muestran
      existencias — están en el
      <ULink to="/productos" class="underline">catálogo</ULink>, en la fila del
      producto base.
    </p>
  </UContainer>
</template>
