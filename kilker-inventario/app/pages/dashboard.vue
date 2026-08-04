<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
const apiFetch = useApiFetch()


useHead({ title: 'Dashboard · Inventario Kilker' })

const { products, pending: loadingProducts, error: productsError, refresh: refreshProducts } = useAllProducts()
const { data: stores, refresh: refreshStores } = useStores()
const {
  pending: loadingAverageCosts,
  storeId: averageCostsStoreId,
  refresh: refreshAverageCosts,
} = useAverageCosts()

const { me } = useMe()   
const isEmployee = computed(() => me.value?.role === 'empleado')   // ← NUEVO

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

const {
  expenses,
  pending: loadingExpenses,
  storeId: expensesStoreId,
  from: expensesFrom,
  to: expensesTo,
  refresh: refreshExpenses
} = useAllExpenses()

// ───────────────────────────────────────────────
//  GASTOS: subtotal (a pagar), pagado y pendiente — agrupado por tipo
// ───────────────────────────────────────────────
const expensesByType = computed(() => {
  const result = {
    Fijo: { subtotal: 0, totalPaid: 0, balance: 0 },
    Operativo: { subtotal: 0, totalPaid: 0, balance: 0 }
  }
  for (const e of expenses.value) {
    result[e.type].subtotal += e.subtotal
    result[e.type].totalPaid += Number(e.totalPaid)
    result[e.type].balance += Number(e.balance)
  }
  return result
})

const totalExpensesFijo = computed(() => expensesByType.value.Fijo.subtotal)
const totalExpensesOperativo = computed(() => expensesByType.value.Operativo.subtotal)

const totalExpensesPaid = computed(
  () => expensesByType.value.Fijo.totalPaid + expensesByType.value.Operativo.totalPaid
)
const totalExpensesPending = computed(
  () => expensesByType.value.Fijo.balance + expensesByType.value.Operativo.balance
)

// Si también quieres el desglose pagado/pendiente POR tipo (no solo el total combinado):
const totalExpensesPaidFijo = computed(() => expensesByType.value.Fijo.totalPaid)
const totalExpensesPaidOperativo = computed(() => expensesByType.value.Operativo.totalPaid)
const totalExpensesPendingFijo = computed(() => expensesByType.value.Fijo.balance)
const totalExpensesPendingOperativo = computed(() => expensesByType.value.Operativo.balance)

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0
})
const number = new Intl.NumberFormat('es-MX')

const {
  topProducts,
  pending: loadingTopProducts,
  storeId: topProductsStoreId,
  from: topProductsFrom,
  to: topProductsTo,
  limit: topProductsLimit,
  refresh: refreshTopProducts
} = useTopProducts()



interface TopProductRow {
  productId: number
  totalRevenue: number
  totalCost: number
  profit: number
}

const allProductsTotals = ref<{ totalCost: number; totalRevenue: number; totalProfit: number } | null>(null)
const loadingAllProductsTotals = ref(false)

async function refreshAllProductsTotals() {
  loadingAllProductsTotals.value = true
  try {
    const query: Record<string, any> = { limit: 0 }
    if (selectedStoreId.value) query.storeId = selectedStoreId.value
    if (periodFrom.value) query.from = periodFrom.value
    if (periodTo.value) query.to = periodTo.value

    const rows = await apiFetch<TopProductRow[]>('/api/reports/top-products', { query })

    const totalRevenue = rows.reduce((sum, r) => sum + r.totalRevenue, 0)
    const totalCost = rows.reduce((sum, r) => sum + r.totalCost, 0)
    allProductsTotals.value = {
      totalCost,
      totalRevenue,
      totalProfit: totalRevenue - totalCost
    }
  } catch (e) {
    console.error('Error al cargar totales de productos:', e)
    allProductsTotals.value = null
  } finally {
    loadingAllProductsTotals.value = false
  }
}

const allProductsProfitPct = computed(() => {
  if (!allProductsTotals.value || allProductsTotals.value.totalRevenue <= 0) return 0
  return (allProductsTotals.value.totalProfit / allProductsTotals.value.totalRevenue) * 100
})

// --- DEFINIR PERIODFROM Y PERIODTO ---
const periodFrom = ref<string | undefined>(undefined)
const periodTo = ref<string | undefined>(undefined)

// Selector de sucursal: 0 = todas.
const storeFilterItems = computed(() => {
  if (isEmployee.value && me.value?.storeId != null) {
    // El empleado solo ve su propia sucursal en el selector.
    const own = stores.value.find((s) => s.id === me.value?.storeId)
    return own ? [{ label: `${own.code} · ${own.name}`, value: own.id }] : []
  }
  return [
    { label: 'Todas las sucursales', value: 0 },
    ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
  ]
})
const selectedStoreId = ref(0)

watch(
  () => me.value?.storeId,
  (storeId) => {
    if (isEmployee.value && storeId != null) {
      selectedStoreId.value = storeId
    }
  },
  { immediate: true }
)

// --- FUNCIÓN CENTRAL DE REFRESH ---
const refreshAllData = async () => {
  try {
    await Promise.all([refreshProducts(), refreshStores()])

    const storeId = selectedStoreId.value || undefined
    movementsStoreId.value = storeId
    salesStoreId.value = storeId
    averageCostsStoreId.value = storeId
    topProductsStoreId.value = storeId
    expensesStoreId.value = storeId
    monthlyStoreId.value = storeId
    
    movementsFrom.value = periodFrom.value
    movementsTo.value = periodTo.value
    salesFrom.value = periodFrom.value
    salesTo.value = periodTo.value
    topProductsFrom.value = periodFrom.value
    topProductsTo.value = periodTo.value
    expensesFrom.value = periodFrom.value
    expensesTo.value = periodTo.value
    monthlyMonth.value = derivedMonth.value

    await Promise.all([
      refreshMovements(),
      refreshSales(),
      refreshAverageCosts(),
      refreshTopProducts(),
      refreshExpenses(),
      refreshMonthly(),
      refreshAllProductsTotals()
    ])
  } catch (error) {
    console.error('Error al refrescar datos:', error)
  }
}




// --- WATCH EFECTIVO PARA CAMBIOS DE FILTRO ---
watch(selectedStoreId, () => {
  console.log(' Cambio de sucursal detectado')
  refreshAllData()
})

watch([periodFrom, periodTo], () => {
  console.log(' Cambio de periodo detectado')
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
      return
    }
    
    
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


// --- CICLO DE VIDA ---
onMounted(async () => {
  await refreshAllData()
  lastRefreshTime.value = Date.now()
  document.addEventListener('visibilitychange', handleVisibilityChange)
    refreshMonthly()

})

onUnmounted(() => {
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



// --- VALOR DE ENTRADAS Y SALIDAS ---
const entryValue = computed(() =>
  movements.value
    .filter((m) => m.supplierInvoiceNumber?.trim().toUpperCase() !== 'II')
    .reduce((sum, m) => sum + Number(m.totalValue), 0)
)

const salesValue = computed(() =>
  sales.value
    .filter((s) => s.status === 'emitida')
    .reduce((sum, s) => sum + Number(s.totalAmount), 0)
)

const totalExpenses = computed(() =>
  expenses.value.reduce((sum, e) => sum + Number(e.amount), 0)
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

const {
  data: monthlyInventory,
  pending: loadingMonthly,
  month: monthlyMonth,
  storeId: monthlyStoreId,
  refresh: refreshMonthly
} = useMonthlyInventory()

// Deriva YYYY-MM desde el filtro de periodo global. Si no hay periodo elegido
// ("Todo"), cae al mes calendario actual como default razonable.
const derivedMonth = computed(() => {
  if (periodFrom.value) return periodFrom.value.slice(0, 7)
  return new Date().toISOString().slice(0, 7)
})

watch(
  derivedMonth,
  (m) => {
    monthlyMonth.value = m
    refreshMonthly()
  },
  { immediate: true }
)
// --- MÉTRICAS ---
const totalProducts = computed(() => products.value.length)
const activeProducts = computed(() => products.value.filter((p) => p.isActive).length)
const totalUnits = computed(() => products.value.reduce((sum, p) => sum + stockFor(p), 0))

const metricsSection1 = computed(() => {
  const all = [
    {
      label: 'Productos',
      value: number.format(totalProducts.value),
      hint: `${activeProducts.value} activos`,
      icon: 'i-lucide-package',
      color: 'text-primary',
      loading: loadingProducts.value,
      globalOnly: false
    },
    {
      label: 'Existencias',
      value: number.format(monthlyInventory.value?.endingUnits ?? 0),
      hint: `al cierre de ${derivedMonth.value}`,
      icon: 'i-lucide-boxes',
      color: 'text-info',
      loading: loadingProducts.value || loadingMonthly.value,
      globalOnly: false
    },

  ]
  
  return selectedStoreId.value ? all.filter((m) => !m.globalOnly) : all
})

const metricsSection2 = computed(() => {
  const all = [
    {
      label: 'Compras',
      value: currency.format(entryValue.value),
      hint: 'en el periodo',
      icon: 'i-lucide-arrow-up-right',
      color: 'text-info',
      loading: loadingMovements.value,
      globalOnly: false
    },
    {
      label: 'Ventas',
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
 all.push({
    label: 'Costo total',
    value: currency.format(allProductsTotals.value?.totalCost ?? 0),
    hint: 'de todos los productos vendidos',
    icon: 'i-lucide-receipt',
    color: 'text-warning',
    loading: loadingAllProductsTotals.value,
    globalOnly: false
  })

  all.push({
    label: 'Venta total',
    value: currency.format(allProductsTotals.value?.totalRevenue ?? 0),
    hint: 'de todos los productos vendidos',
    icon: 'i-lucide-trending-up',
    color: 'text-info',
    loading: loadingAllProductsTotals.value,
    globalOnly: false
  })

   all.push({
  label: 'Utilidad total',
  value: currency.format(allProductsTotals.value?.totalProfit ?? 0),
  hint: `${allProductsProfitPct.value.toFixed(1)}% sobre ventas totales`,
  icon: (allProductsTotals.value?.totalProfit ?? 0) >= 0 ? 'i-lucide-circle-check' : 'i-lucide-alert-circle',
  color: (allProductsTotals.value?.totalProfit ?? 0) >= 0 ? 'text-success' : 'text-error',
  loading: loadingAllProductsTotals.value,
  globalOnly: false
})

all.push({
  label: 'Gastos fijos',
  value: currency.format(totalExpensesFijo.value),
  hint: 'sin IVA/retenciones · en el periodo',
  icon: 'i-lucide-home',
  color: 'text-warning',
  loading: loadingExpenses.value,
  globalOnly: false
})





all.push({
  label: 'Gastos Fijos pagados',
  value: currency.format(totalExpensesPaidFijo.value),
  hint: 'en el periodo',
  icon: 'i-lucide-circle-check',
  color: 'text-success',
  loading: loadingExpenses.value,
  globalOnly: false
})

all.push({
  label: 'Gastos Fijos pendientes',
  value: currency.format(totalExpensesPendingFijo.value),
  hint: 'por pagar',
  icon: 'i-lucide-clock',
  color: 'text-error',
  loading: loadingExpenses.value,
  globalOnly: false
})

all.push({
  label: 'Gastos operativos',
  value: currency.format(totalExpensesOperativo.value),
  hint: 'sin IVA/retenciones · en el periodo',
  icon: 'i-lucide-wrench',
  color: 'text-warning',
  loading: loadingExpenses.value,
  globalOnly: false
})

all.push({
  label: 'Gastos Operativos pagados',
  value: currency.format(totalExpensesPaidOperativo.value),
  hint: 'en el periodo',
  icon: 'i-lucide-circle-check',
  color: 'text-success',
  loading: loadingExpenses.value,
  globalOnly: false
})

all.push({
  label: 'Gastos Operativos pendientes',
  value: currency.format(totalExpensesPendingOperativo.value),
  hint: 'por pagar',
  icon: 'i-lucide-clock',
  color: 'text-error',
  loading: loadingExpenses.value,
  globalOnly: false
})





return selectedStoreId.value ? all.filter((m) => !m.globalOnly) : all

})



const isLoading = computed(
  () =>
    loadingProducts.value ||
    loadingMovements.value ||
    loadingSales.value ||
    loadingAverageCosts.value ||
    loadingTopProducts.value ||
    loadingExpenses.value ||
    loadingMonthly.value ||
    loadingAllProductsTotals.value
)

/**
 * Porcentaje que ocupa el COSTO dentro de la barra (0-100). El resto es
 * utilidad. Si el costo supera la venta (pérdida en ese producto), se topa
 * en 100% rojo — no hay "utilidad negativa" que representar visualmente.
 */
function costSharePct(p: (typeof topProducts.value)[number]) {
  if (p.totalRevenue <= 0) return 100
  const pct = (p.totalCost / p.totalRevenue) * 100
  return Math.min(100, Math.max(0, pct))
}

const topProductSearch = ref('')

const filteredTopProducts = computed(() => {
  if (!topProductSearch.value.trim()) return topProducts.value
  const q = topProductSearch.value.trim().toLowerCase()
  return topProducts.value.filter(
    (p) => p.productName?.toLowerCase().includes(q) || p.productSku?.toLowerCase().includes(q)
  )
})
</script>

<template>
  <UContainer class="py-8 space-y-8">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Dashboard</h1>
        <p class="text-sm text-muted">Resumen del inventario · datos reales</p>
      </div>
      <div class="flex gap-2">
      
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

<USelect
  v-model="selectedStoreId"
  :items="storeFilterItems"
  :disabled="isEmployee"
  class="w-64"
/>
<h2 v-if="!selectedStoreId && !isEmployee" class="flex items-center gap-2 font-semibold">
  <UIcon name="i-lucide-store" class="size-5 text-warning" />
  Sucursales
  <UBadge :label="number.format(activeStores)" color="warning" variant="subtle" class="ml-1" />
</h2>

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
<UCard v-for="m in metricsSection1" :key="m.label" :ui="{ body: 'p-3 sm:p-4' }">
  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0 flex-1">
      <p class="text-xs text-muted">{{ m.label }}</p>
      <template v-if="m.loading">
        <USkeleton class="h-6 w-20 mt-1" />
        <USkeleton class="h-2.5 w-14 mt-1.5" />
      </template>
      <template v-else>
        <p class="mt-0.5 text-xl font-semibold">{{ m.value }}</p>
        <p class="text-xs text-muted mt-0.5">{{ m.hint }}</p>
      </template>
    </div>
    <UIcon :name="m.icon" :class="['size-6 shrink-0', m.color]" />
  </div>
</UCard>
 <UCard :ui="{ body: 'p-3 sm:p-4' }">
  <template #header>
    <div class="flex items-center gap-2 py-0">
      <UIcon name="i-lucide-calendar-range" class="size-4 text-primary" />
      <h2 class="text-sm font-semibold">Cierre de inventario por mes</h2>
      <span class="ml-auto text-xs text-muted">{{ derivedMonth }}</span>
    </div>
  </template>

  <p v-if="loadingMonthly" class="text-xs text-muted py-2 text-center">Calculando…</p>
  <div v-else-if="monthlyInventory" class="grid gap-4 sm:grid-cols-3">
    <div>
      <p class="text-xs text-muted">Inventario al cierre</p>
      <p class="mt-0.5 text-lg font-semibold text-success">
        {{ currency.format(monthlyInventory.endingInventoryValue) }}
      </p>
    </div>
  </div>
</UCard>
      <UCard v-for="m in metricsSection2" :key="m.label">
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

    <UCard>
  <template #header>
  <div class="flex items-center gap-2 flex-wrap">
    <UIcon name="i-lucide-bar-chart-3" class="size-5 text-primary" />
    <h2 class="font-semibold">Productos más vendidos</h2>
    <UInput
      v-model="topProductSearch"
      icon="i-lucide-search"
      placeholder="Buscar producto…"
      size="sm"
      class="w-48"
    />
    <USelect
      v-model="topProductsLimit"
      :items="[{ label: 'Top 5', value: 5 }, { label: 'Top 10', value: 10 }, { label: 'Todos', value: 0 }]"
      class="ml-auto w-32"
      @update:model-value="refreshTopProducts"
    />
  </div>
</template>

  <!-- Estado de carga -->
  <div v-if="loadingTopProducts" class="py-6 text-center">
    <USpinner class="size-8 animate-spin text-primary" />
    <p class="mt-2 text-sm text-muted">Cargando productos más vendidos...</p>
  </div>

  <!-- Sin datos -->
  <p v-else-if="!topProducts.length" class="text-sm text-muted py-6 text-center">
    Sin ventas registradas en el periodo.
  </p>

  <!-- Lista de productos -->
 <ul v-else class="space-y-3">
  <li v-for="p in filteredTopProducts" :key="p.productId">
    <div class="flex items-center justify-between gap-3 mb-1">
  <p class="text-sm font-medium truncate">
    {{ p.productName }} - {{ p.productSku }}
  </p>

  <div class="flex items-center gap-1 shrink-0">
    <p class="text-xs text-muted">
      {{ number.format(p.totalQuantity) }} {{ UNIT_LABELS[p.unit] }}(s)
    </p>

    <UButton
      :to="`/ventas?productId=${p.productId}`"
      size="xs"
      color="neutral"
      variant="ghost"
      icon="i-lucide-external-link"
      title="Ver historial de ventas de este producto"
    />
  </div>
</div>

    <!-- Con ventas: costo/venta/utilidad + barra roja/verde -->
    <template v-if="p.hasSales">
      <div class="flex items-center justify-between gap-3 text-xs mb-1.5">
        <span class="text-muted">Costo: {{ currency.format(p.totalCost) }}</span>
        <span class="text-muted">Venta: {{ currency.format(p.totalRevenue) }}</span>
        <span :class="p.profit >= 0 ? 'text-success' : 'text-error'" class="font-medium">
          Utilidad: {{ currency.format(p.profit) }} ({{ p.profitPct.toFixed(1) }}%)
        </span>
      </div>
      <div class="h-2 rounded-full bg-elevated overflow-hidden" :style="{ width: `${(p.totalQuantity / topProducts.reduce((max, item) => Math.max(max, item.totalQuantity), 0)) * 100}%` }">
        <div class="h-full flex">
          <div class="h-full bg-error transition-all duration-500" :style="{ width: `${costSharePct(p)}%` }" />
          <div class="h-full bg-success transition-all duration-500" :style="{ width: `${100 - costSharePct(p)}%` }" />
        </div>
      </div>
    </template>

    <!-- Sin ventas: solo costo de inventario, sin utilidad -->
    <div v-else class="flex items-center justify-between gap-2">
      <span class="text-xs text-muted">Sin ventas en el periodo</span>
      <span class="text-xs text-warning">En existencia: {{ currency.format(p.totalCost) }}</span>
    </div>
  </li>
</ul>
</UCard>


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
