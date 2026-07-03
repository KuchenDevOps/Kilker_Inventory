<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';

useHead({ title: 'Dashboard · Inventario Kilker' })

const { data: products, pending: loadingProducts, error: productsError, refresh: refreshProducts } = useProducts()
const { data: stores, refresh: refreshStores } = useStores()
const { data: averageCosts, refresh: refreshAverageCosts } = useAverageCosts()


const {
  movements,
  pending: loadingMovements,
  storeId: movementsStoreId,
  from: movementsFrom,
  to: movementsTo,
  refresh: refreshMovements
} = useMovements()

const {
  sales,
  pending: loadingSales,
  storeId: salesStoreId,
  from: salesFrom,
  to: salesTo,
  refresh: refreshSales
} = useSales()

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0
})
const number = new Intl.NumberFormat('es-MX')

// --- DEFINIR PERIODFROM Y PERIODTO ---
const periodFrom = ref<string | undefined>(undefined)
const periodTo = ref<string | undefined>(undefined)

// Selector de sucursal: 0 = todas.
const storeFilterItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])
const selectedStoreId = ref(0)

// --- FUNCIÓN CENTRAL DE REFRESH ---
const refreshAllData = async () => {
  try {
    await Promise.all([
      refreshProducts(),
      refreshStores(),
      refreshAverageCosts() // ← nuevo, independiente del periodo/sucursal
    ])

    const storeId = selectedStoreId.value || undefined
    movementsStoreId.value = storeId
    salesStoreId.value = storeId

    movementsFrom.value = periodFrom.value
    movementsTo.value = periodTo.value
    salesFrom.value = periodFrom.value
    salesTo.value = periodTo.value

    await Promise.all([refreshMovements(), refreshSales()])
  } catch (error) {
    console.error('❌ Error al refrescar datos:', error)
  }
}


// --- WATCH EFECTIVO PARA CAMBIOS DE FILTRO ---
watch(selectedStoreId, () => {
  console.log('🔄 Cambio de sucursal detectado')
  refreshAllData()
})

watch([periodFrom, periodTo], () => {
  console.log('🔄 Cambio de periodo detectado')
  refreshAllData()
})

// --- MANEJADOR DE VISIBILIDAD ---
let visibilityTimeoutId: ReturnType<typeof setTimeout> | null = null
let lastRefreshTime = ref(Date.now())
const MIN_REFRESH_INTERVAL = 5000

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    const now = Date.now()
    if (now - lastRefreshTime.value < MIN_REFRESH_INTERVAL) {
      console.log('⏳ Refresco demasiado rápido, omitiendo...')
      return
    }
    
    console.log('👁️ Pestaña activada - programando refresco')
    
    if (visibilityTimeoutId) {
      clearTimeout(visibilityTimeoutId)
      visibilityTimeoutId = null
    }
    
    visibilityTimeoutId = setTimeout(() => {
      refreshAllData()
      lastRefreshTime.value = Date.now()
      visibilityTimeoutId = null
    }, 500)
  }
}

// --- REFRESCO PERIÓDICO ---
let intervalId: ReturnType<typeof setInterval> | null = null

const startPeriodicRefresh = () => {
  if (intervalId) clearInterval(intervalId)
  intervalId = setInterval(() => {
    if (document.visibilityState === 'visible') {
      console.log('⏰ Refresco periódico automático')
      refreshAllData()
      lastRefreshTime.value = Date.now()
    }
  }, 300000)
}

// --- CICLO DE VIDA ---
onMounted(async () => {
  console.log('🚀 Dashboard montado - cargando datos iniciales')
  await refreshAllData()
  lastRefreshTime.value = Date.now()
  document.addEventListener('visibilitychange', handleVisibilityChange)
  startPeriodicRefresh()
})

onUnmounted(() => {
  console.log('🧹 Limpiando listeners y timeouts')
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (visibilityTimeoutId) {
    clearTimeout(visibilityTimeoutId)
    visibilityTimeoutId = null
  }
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
})

// --- FUNCIONES DE UTILIDAD ---

/** Existencia de un producto: en la sucursal elegida, o el total si es "todas". */
function stockFor(p: (typeof products.value)[number]) {
  if (!selectedStoreId.value) return p.totalStock
  return p.byStore.find((b) => b.storeId === selectedStoreId.value)?.quantity ?? 0
}

// Mapa producto×sucursal → costo promedio, construido desde el histórico
// completo (no depende del periodo ni de selectedStoreId).
const averageCostMap = computed(() => {
  const map = new Map<string, number>()
  averageCosts.value.forEach((r) => {
    map.set(`${r.productId}-${r.storeId}`, r.avgCost)
  })
  return map
})

const getAverageCostByStore = (productId: number, storeId: number): number => {
  const key = `${productId}-${storeId}`
  const cost = averageCostMap.value.get(key)
  if (cost != null) return cost

  // Sin entradas históricas para esta sucursal: fallback al costo del producto.
  const product = products.value.find((p) => p.id === productId)
  return Number(product?.cost ?? 0)
}



// --- NUEVO: Valor de inventario con costo por sucursal ---
const inventoryValue = computed(() => {
  let total = 0

  products.value.forEach(p => {
    const stock = stockFor(p)
    if (stock === 0) return

    let avgCost = 0

    if (selectedStoreId.value) {
      // Sucursal específica: costo promedio ponderado de ESA sucursal
      avgCost = getAverageCostByStore(p.id, selectedStoreId.value)
    } else {
      // Todas las sucursales: promedio ponderado por cantidad en stock,
      // combinando el costo promedio de cada sucursal donde hay existencia
      const storesWithStock = p.byStore.filter(b => b.quantity > 0)

      if (storesWithStock.length > 0) {
        let totalCost = 0
        let totalQty = 0
        storesWithStock.forEach(b => {
          const cost = getAverageCostByStore(p.id, b.storeId)
          totalCost += cost * Number(b.quantity)
          totalQty += Number(b.quantity)
        })
        avgCost = totalQty > 0 ? totalCost / totalQty : Number(p.cost ?? 0)
      } else {
        avgCost = Number(p.cost ?? 0)
      }
    }

    total += avgCost * stock
  })

  return total
})

// --- VALOR DE ENTRADAS Y SALIDAS ---
const entryValue = computed(() =>
  movements.value.reduce((sum, m) => sum + Number(m.totalValue), 0)
)

const salesValue = computed(() =>
  sales.value
    .filter((s) => s.status === 'emitida')
    .reduce((sum, s) => sum + Number(s.totalAmount), 0)
)

const totalLoses = computed(() => salesValue.value - entryValue.value)

const activeStores = computed(() => stores.value.filter((s) => s.isActive).length)
const totalCategories = computed(
  () => new Set(products.value.map((p) => p.categoryId).filter((id) => id != null)).size
)

const lowStock = computed(() =>
  products.value
    .filter((p) => p.isActive && p.minQuantity != null)
    .map((p) => ({ product: p, stock: stockFor(p), min: Number(p.minQuantity) }))
    .filter((row) => row.stock < row.min)
    .sort((a, b) => a.stock - b.stock)
)

const recentProducts = computed(() => {
  const list = selectedStoreId.value
    ? products.value.filter((p) => p.byStore.some((b) => b.storeId === selectedStoreId.value))
    : products.value
  return list.slice(0, 6)
})

// --- MÉTRICAS ---
const totalProducts = computed(() => products.value.length)
const activeProducts = computed(() => products.value.filter((p) => p.isActive).length)
const totalUnits = computed(() => products.value.reduce((sum, p) => sum + stockFor(p), 0))

const metrics = computed(() => {
  const all = [
    {
      label: 'Productos',
      value: number.format(totalProducts.value),
      hint: `${activeProducts.value} activos`,
      icon: 'i-lucide-package',
      color: 'text-primary',
      loading: loadingProducts.value,
      globalOnly: true
    },
    {
      label: 'Existencias',
      value: number.format(totalUnits.value),
      hint: 'unidades en sistema',
      icon: 'i-lucide-boxes',
      color: 'text-info',
      loading: loadingProducts.value,
      globalOnly: false
    },
    {
      label: 'Valor de inventario (costo por sucursal)',
      value: currency.format(inventoryValue.value),
      hint: selectedStoreId.value 
        ? `costo promedio de ${stores.value.find(s => s.id === selectedStoreId.value)?.code ?? 'sucursal'}`
        : 'costo promedio por sucursal',
      icon: 'i-lucide-banknote',
      color: 'text-success',
      loading: loadingProducts.value || loadingMovements.value,
      globalOnly: false
    },
    {
      label: 'Sucursales',
      value: number.format(activeStores.value),
      hint: `${totalCategories.value} categorías`,
      icon: 'i-lucide-store',
      color: 'text-warning',
      loading: false,
      globalOnly: true 
    },
    {
      label: 'Valor de entradas',
      value: currency.format(entryValue.value),
      hint: 'en el periodo',
      icon: 'i-lucide-arrow-up-right',
      color: 'text-info',
      loading: loadingMovements.value,
      globalOnly: false
    },
    {
      label: 'Valor de salidas',
      value: currency.format(salesValue.value),
      hint: 'en el periodo',
      icon: 'i-lucide-arrow-down-right',
      color: 'text-error',
      loading: loadingSales.value,
      globalOnly: false
    }
  ]
  
  if (totalLoses.value < 0) {
    all.push({
      label: 'Pérdidas',
      value: currency.format(totalLoses.value),
      hint: 'en el periodo',
      icon: 'i-lucide-alert-circle',
      color: 'text-error',
      loading: loadingSales.value || loadingMovements.value,
      globalOnly: false
    })
  } else {
    all.push({
      label: 'Ganancias',
      value: currency.format(totalLoses.value),
      hint: 'en el periodo',
      icon: 'i-lucide-check-circle',
      color: 'text-success',
      loading: loadingSales.value || loadingMovements.value,
      globalOnly: false
    })
  }

  return selectedStoreId.value ? all.filter((m) => !m.globalOnly) : all
})

const isLoading = computed(() => loadingProducts.value || loadingMovements.value || loadingSales.value)

</script>

<template>
  <UContainer class="py-8 space-y-8">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Dashboard</h1>
        <p class="text-sm text-muted">Resumen del inventario · datos reales</p>
      </div>
      <div class="flex gap-2">
        <UButton
          @click="refreshAllData"
          :loading="isLoading"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="sm"
        >
          Actualizar
        </UButton>
        <UButton to="/productos/nuevo" icon="i-lucide-plus" color="primary">
          Nuevo producto
        </UButton>
      </div>
    </header>

    <div class="flex flex-wrap items-center gap-3">
      <FiltroCortePeriodo v-model:from="periodFrom" v-model:to="periodTo" />
      <span class="text-xs text-muted ml-auto">
        Última actualización: {{ new Date(lastRefreshTime).toLocaleTimeString() }}
      </span>
    </div>

    <USelect v-model="selectedStoreId" :items="storeFilterItems" class="w-64" />

    <UAlert
      v-if="productsError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los productos"
      :description="productsError.message"
    />

    <!-- Tarjetas de métricas -->
    <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard v-for="m in metrics" :key="m.label">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <p class="text-sm text-muted">{{ m.label }}</p>
            <template v-if="m.loading">
              <USkeleton class="h-8 w-24 mt-1" />
              <USkeleton class="h-3 w-16 mt-2" />
            </template>
            <template v-else>
              <p class="mt-1 text-2xl font-semibold">{{ m.value }}</p>
              <p class="text-xs text-muted mt-1">{{ m.hint }}</p>
            </template>
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
              <span class="text-sm text-muted tabular-nums">{{ stockFor(p) }} u.</span>
            </div>
          </li>
        </ul>
      </UCard>
    </div>
  </UContainer>
</template>