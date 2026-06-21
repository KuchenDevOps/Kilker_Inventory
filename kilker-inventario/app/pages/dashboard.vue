<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

useHead({ title: 'Dashboard · Inventario Kilker' })

const { data: products, pending: loadingProducts, error: productsError } = useProducts()
const { data: stores } = useStores()

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0
})
const number = new Intl.NumberFormat('es-MX')

const totalProducts = computed(() => products.value.length)
const activeProducts = computed(() => products.value.filter((p) => p.isActive).length)
const totalUnits = computed(() =>
  products.value.reduce((sum, p) => sum + p.totalStock, 0)
)
/** Valor del inventario a precio de venta: Σ (precio × existencias). */
const inventoryValue = computed(() =>
  products.value.reduce((sum, p) => sum + Number(p.price) * p.totalStock, 0)
)
const activeStores = computed(() => stores.value.filter((s) => s.isActive).length)
const totalCategories = computed(
  () => new Set(products.value.map((p) => p.categoryId).filter((id) => id != null)).size
)

/** Productos activos cuya existencia total está bajo el mínimo definido. */
const lowStock = computed(() =>
  products.value
    .filter((p) => p.isActive && p.minQuantity != null)
    .map((p) => ({ product: p, stock: p.totalStock, min: Number(p.minQuantity) }))
    .filter((row) => row.stock < row.min)
    .sort((a, b) => a.stock - b.stock)
)

/** El endpoint ya ordena por fecha de alta desc; tomamos los primeros. */
const recentProducts = computed(() => products.value.slice(0, 6))

const metrics = computed(() => [
  {
    label: 'Productos',
    value: number.format(totalProducts.value),
    hint: `${activeProducts.value} activos`,
    icon: 'i-lucide-package',
    color: 'text-primary'
  },
  {
    label: 'Existencias',
    value: number.format(totalUnits.value),
    hint: 'unidades en sistema',
    icon: 'i-lucide-boxes',
    color: 'text-info'
  },
  {
    label: 'Valor de inventario',
    value: currency.format(inventoryValue.value),
    hint: 'a precio de venta',
    icon: 'i-lucide-banknote',
    color: 'text-success'
  },
  {
    label: 'Sucursales',
    value: number.format(activeStores.value),
    hint: `${totalCategories.value} categorías`,
    icon: 'i-lucide-store',
    color: 'text-warning'
  }
])
</script>

<template>
  <UContainer class="py-8 space-y-8">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Dashboard</h1>
        <p class="text-sm text-muted">Resumen del inventario · datos reales</p>
      </div>
      <UButton to="/productos/nuevo" icon="i-lucide-plus" color="primary">
        Nuevo producto
      </UButton>
    </header>

    <UAlert
      v-if="productsError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los productos"
      :description="productsError.message"
    />

    <!-- Tarjetas de métricas -->
    <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <UCard v-for="m in metrics" :key="m.label">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="text-sm text-muted">{{ m.label }}</p>
            <p class="mt-1 text-2xl font-semibold">{{ m.value }}</p>
            <p class="text-xs text-muted mt-1">{{ m.hint }}</p>
          </div>
          <UIcon :name="m.icon" :class="['size-7 shrink-0', m.color]" />
        </div>
      </UCard>
    </section>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Alertas de stock bajo -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-triangle-alert" class="size-5 text-warning" />
            <h2 class="font-semibold">Stock bajo mínimo</h2>
            <UBadge
              v-if="lowStock.length"
              :label="String(lowStock.length)"
              color="warning"
              variant="subtle"
              class="ml-auto"
            />
          </div>
        </template>

        <p v-if="loadingProducts" class="text-sm text-muted py-6 text-center">
          Cargando…
        </p>
        <p v-else-if="!lowStock.length" class="text-sm text-muted py-6 text-center">
          Sin alertas: todo el stock está por encima del mínimo. 🎉
        </p>
        <ul v-else class="divide-y divide-default">
          <li
            v-for="row in lowStock"
            :key="row.product.id"
            class="flex items-center justify-between gap-3 py-2.5"
          >
            <div class="min-w-0">
              <p class="font-medium truncate">{{ row.product.name }}</p>
              <p class="text-xs text-muted">{{ row.product.sku }}</p>
            </div>
            <div class="text-right shrink-0">
              <p class="text-sm font-semibold text-warning">
                {{ row.stock }} / {{ row.min }}
              </p>
              <p class="text-xs text-muted">existencia / mínimo</p>
            </div>
          </li>
        </ul>
      </UCard>

      <!-- Productos recientes -->
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-clock" class="size-5 text-muted" />
            <h2 class="font-semibold">Productos recientes</h2>
            <UButton
              to="/productos"
              variant="link"
              color="neutral"
              size="xs"
              class="ml-auto"
              trailing-icon="i-lucide-arrow-right"
            >
              Ver catálogo
            </UButton>
          </div>
        </template>

        <p v-if="loadingProducts" class="text-sm text-muted py-6 text-center">
          Cargando…
        </p>
        <p
          v-else-if="!recentProducts.length"
          class="text-sm text-muted py-6 text-center"
        >
          Aún no hay productos. Da de alta el primero.
        </p>
        <ul v-else class="divide-y divide-default">
          <li
            v-for="p in recentProducts"
            :key="p.id"
            class="flex items-center justify-between gap-3 py-2.5"
          >
            <div class="min-w-0">
              <p class="font-medium truncate">{{ p.name }}</p>
              <p class="text-xs text-muted">
                {{ p.sku }} · {{ p.category ?? 'sin categoría' }} ·
                {{ UNIT_LABELS[p.unit] }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <UBadge
                :label="p.isActive ? 'Activo' : 'Inactivo'"
                :color="p.isActive ? 'success' : 'neutral'"
                variant="subtle"
              />
              <span class="text-sm text-muted tabular-nums">{{ p.totalStock }} u.</span>
            </div>
          </li>
        </ul>
      </UCard>
    </div>
  </UContainer>
</template>
