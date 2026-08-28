<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

useHead({ title: 'Dashboard · Inventario Kilker' })

// Catálogo y sucursales: lecturas públicas, no cuestan verificación de token.
// Se cargan una sola vez (no dependen del periodo ni de la sucursal elegida).
const { products, pending: loadingProducts, error: productsError } = useAllProducts()
const { data: stores } = useStores()


const { me, canWrite, isStoreScoped } = useMe()

// Todas las métricas agregadas en UNA petición (ver useDashboardSummary).
const {
  data: summary,
  pending: loadingSummary,
  error: summaryError,
  refresh: refreshSummary
} = useDashboardSummary()

// ───────────────────────────────────────────────
//  GASTOS: total a pagar, pagado y pendiente — agrupado por tipo
// ───────────────────────────────────────────────
// ⚠️ El total es `totalToPay` (subtotal + IVA − retenciones), NO el subtotal.
// Este dashboard es operativo: sus tres cifras tienen que cuadrar entre sí
// —total = pagado + pendiente— y tanto `totalPaid` como `balance` se miden
// contra el pagable. Con el subtotal aquí, un gasto liquidado mostraba un
// "pagado" mayor que su propio total y la resta no daba.
//
// El desglose fiscal (subtotal vs. IVA) va en /dashboardresultados, que es el
// de resultados del negocio: ahí sí importa separar el IVA, porque se entera al
// SAT y no es gasto propio.
const EMPTY_BUCKET = { subtotal: 0, iva: 0, totalToPay: 0, totalPaid: 0, balance: 0 }

const expensesByType = computed(
  () => summary.value?.expenses ?? { Fijo: EMPTY_BUCKET, Operativo: EMPTY_BUCKET }
)

const totalExpensesFijo = computed(() => expensesByType.value.Fijo.totalToPay)
const totalExpensesOperativo = computed(() => expensesByType.value.Operativo.totalToPay)

const totalExpensesPaid = computed(
  () => expensesByType.value.Fijo.totalPaid + expensesByType.value.Operativo.totalPaid
)

// Desglose pagado/pendiente por tipo de gasto.
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

// Lista "productos más vendidos": sigue siendo su propia petición porque
// tiene selector de Top N y búsqueda independientes del resto del dashboard.
const {
  topProducts,
  pending: loadingTopProducts,
  storeId: topProductsStoreId,
  from: topProductsFrom,
  to: topProductsTo,
  limit: topProductsLimit,
  refresh: refreshTopProducts
} = useTopProducts()

// Totales de lo vendido (costo/venta/utilidad): ya vienen en el resumen.
// Antes eran una segunda llamada a top-products con limit=0.
const allProductsTotals = computed(() => summary.value?.soldTotals ?? null)

const netSalesValue = computed(() => summary.value?.salesValue ?? 0)

const allProductsNetProfit = computed(() =>
  Math.round((netSalesValue.value - (allProductsTotals.value?.totalCost ?? 0)) * 100) / 100
)

const allProductsProfitPct = computed(() => {
  if (netSalesValue.value <= 0) return 0
  return (allProductsNetProfit.value / netSalesValue.value) * 100
})

// Piezas vendidas contra capas de costo $0: hunden el "Costo total" e inflan la
// utilidad. No se corrigen inventándoles un costo —el valor del inventario sale
// de esas mismas capas—, se avisan. Detalle en /dashboardresultados.
const zeroCostUnits = computed(() => allProductsTotals.value?.zeroCostUnits ?? 0)
const zeroCostRevenue = computed(() => allProductsTotals.value?.zeroCostRevenue ?? 0)
const hasZeroCostSales = computed(() => zeroCostUnits.value > 0)

// --- DEFINIR PERIODFROM Y PERIODTO ---
const periodFrom = ref<string | undefined>(undefined)
const periodTo = ref<string | undefined>(undefined)

// Selector de sucursal: 0 = todas.
const storeFilterItems = computed(() => {
  if (isStoreScoped.value && me.value?.storeId != null) {
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
    if (isStoreScoped.value && storeId != null) {
      selectedStoreId.value = storeId
    }
  },
  { immediate: true }
)

// ───────────────────────────────────────────────
//  RECARGA
// ───────────────────────────────────────────────
// Una sola función y un solo disparador. Antes había tres caminos que llamaban
// a refreshAllData (montaje, watcher de sucursal, watcher de periodo) y además
// cada composable se auto-observaba, así que una carga del dashboard repetía
// el mismo fetch 3-5 veces.
const lastRefreshTime = ref(Date.now())

async function refreshAllData() {
  const storeId = selectedStoreId.value || undefined

  topProductsStoreId.value = storeId
  topProductsFrom.value = periodFrom.value
  topProductsTo.value = periodTo.value

  await Promise.all([
    refreshSummary({
      storeId,
      from: periodFrom.value,
      to: periodTo.value,
      month: derivedMonth.value
    }),
    refreshTopProducts()
  ])

  lastRefreshTime.value = Date.now()
}

// Colapsa ráfagas: cambiar de periodo mueve `from` y `to` a la vez, y el
// perfil del empleado fija la sucursal justo después del montaje. Con el
// debounce todo eso se resuelve en una sola recarga.
let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null

function scheduleRefresh(delay = 120) {
  if (refreshTimeoutId) clearTimeout(refreshTimeoutId)
  refreshTimeoutId = setTimeout(() => {
    refreshTimeoutId = null
    void refreshAllData()
  }, delay)
}

// Un único watcher para todos los filtros. `me.id` entra porque la primera
// carga real debe esperar a que se resuelva el perfil (y con él, la sucursal
// del empleado).
watch([selectedStoreId, periodFrom, periodTo, () => me.value?.id], () => scheduleRefresh())

// --- MANEJADOR DE VISIBILIDAD ---
// Antes eran 5 s, y encima varios composables registraban su propio listener:
// volver a la pestaña recargaba el dashboard entero en casi cada alt-tab.
const MIN_REFRESH_INTERVAL = 60_000

const handleVisibilityChange = () => {
  if (document.visibilityState !== 'visible') return
  if (Date.now() - lastRefreshTime.value < MIN_REFRESH_INTERVAL) return
  scheduleRefresh(500)
}

// --- CICLO DE VIDA ---
onMounted(() => {
  scheduleRefresh(0)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (refreshTimeoutId) {
    clearTimeout(refreshTimeoutId)
    refreshTimeoutId = null
  }
})

// --- FUNCIONES DE UTILIDAD ---

/** Existencia de un producto: en la sucursal elegida, o el total si es "todas". */
function stockFor(p: (typeof products.value)[number]) {
  if (!selectedStoreId.value) return p.totalStock
  return p.byStore.find((b) => b.storeId === selectedStoreId.value)?.quantity ?? 0
}

// --- VALOR DE ENTRADAS Y SALIDAS ---
// Ambos los agrega ahora el servidor con SUM(), en vez de descargar todas las
// entradas y todas las ventas del periodo para sumarlas aquí.
const entryValue = computed(() => summary.value?.entriesValue ?? 0)
// Pago de esas mismas compras: pagadas + por pagar = Compras.
const entriesPaid = computed(() => summary.value?.entriesPaid ?? 0)
const entriesBalance = computed(() => summary.value?.entriesBalance ?? 0)


const totalLoses = computed(() => allProductsNetProfit.value - totalExpensesPaid.value)
const activeStores = computed(() => stores.value.filter((s) => s.isActive).length)

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

// El cierre de inventario del mes viene dentro del resumen; ya no es una
// petición aparte (ni se recalcula dos veces al montar).
const monthlyInventory = computed(() => summary.value?.monthly ?? null)


const derivedMonth = computed(() => {
  const lastDay = periodTo.value ? new Date(periodTo.value) : new Date()
  if (periodTo.value) lastDay.setDate(lastDay.getDate() - 1)
  return `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}`
})

const dateLabel = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

// Día al que quedó valuado el inventario. Se toma de la respuesta (`to`, que es
// exclusivo → se retrocede un día) para que el rótulo no pueda desmentir al
// número. Sin periodo elegido ("Todo") el corte es el fin del mes.
const cutoffLabel = computed(() => {
  const iso = monthlyInventory.value?.to ?? periodTo.value
  if (!iso) return `cierre de ${derivedMonth.value}`
  const lastDay = new Date(iso)
  lastDay.setDate(lastDay.getDate() - 1)
  return dateLabel.format(lastDay)
})

/**
 * Arranque de la conciliación: el día ANTERIOR a `reconciliation.from`, o sea
 * el 31-dic-2025 — la carga del inventario inicial. `from` es el instante en
 * que arranca la ventana, así que el corte del inventario de apertura es el
 * día de antes.
 */
const reconciliationOpeningLabel = computed(() => {
  const iso = monthlyInventory.value?.reconciliation.from
  if (!iso) return 'la carga inicial'
  const prevDay = new Date(iso)
  prevDay.setDate(prevDay.getDate() - 1)
  return dateLabel.format(prevDay)
})

// Conciliación del inventario. "Compras" y "Costo total" responden otra
// pregunta (lo comprado al proveedor, lo que costó lo vendido) y por eso
// dejan fuera transferencias, anulaciones y la carga inicial: con ellas dos
// la cuenta NO cierra. Estos son los flujos que de verdad mueven el almacén,
// y su suma tiene que dar el inventario final al peso.
//
// ⚠️ Va sobre `monthly.reconciliation`, NO sobre la ventana del periodo: la
// tarjeta acumula desde la carga del inventario inicial (31-dic-2025) hasta el
// corte elegido. Mismo criterio que en /dashboardresultados.
const reconciliation = computed(() => {
  const m = monthlyInventory.value?.reconciliation
  if (!m) return null

  const expected = m.openingInventoryValue + m.inflowsValue - m.soldCost - m.otherOutflowsCost
  return {
    rows: [
      {
        label: `Inventario al ${reconciliationOpeningLabel.value}`,
        detail: `${number.format(m.openingUnits)} artículos`,
        amount: m.openingInventoryValue,
        sign: ''
      },
      {
        label: 'Entradas al inventario',
        // ⚠️ NO decir "compras" aquí: este número NO es la tarjeta "Compras".
        // Aquélla excluye las entradas anuladas (una compra anulada nunca
        // ocurrió); ésta las incluye, porque esa mercancía sí estuvo en el
        // almacén y su reversa se resta abajo, en "Otras salidas". Quitarlas
        // solo de este renglón descuadraría la conciliación por ese importe.
        detail: `entradas de stock ${currency.format(m.entriesValue)} —incluye las anuladas, que se restan abajo— · transferencias recibidas ${currency.format(m.transfersInValue)}`,
        amount: m.inflowsValue,
        sign: '+'
      },
      {
        label: 'Costo de lo vendido',
        detail: 'lo que salió del almacén por ventas, a costo',
        amount: -m.soldCost,
        sign: '−'
      },
      {
        label: 'Otras salidas',
        detail: `transferencias despachadas ${currency.format(m.transfersOutValue)} · anulaciones de entrada`,
        amount: -m.otherOutflowsCost,
        sign: '−'
      }
    ],
    expected,
    actual: m.endingInventoryValue,
    // Debe ser 0. Si no lo es, algo volvió a desalinearse y hay que verlo.
    gap: Math.round((expected - m.endingInventoryValue) * 100) / 100,
    uncoveredValue: m.uncoveredSaleValue,
    uncoveredUnits: m.uncoveredSaleUnits
  }
})

// --- MÉTRICAS ---
const totalProducts = computed(() => products.value.length)
const activeProducts = computed(() => products.value.filter((p) => p.isActive).length)

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
      hint: `al ${cutoffLabel.value}`,
      icon: 'i-lucide-boxes',
      color: 'text-info',
      loading: loadingProducts.value || loadingSummary.value,
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
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Compras pagadas',
      value: currency.format(entriesPaid.value),
      hint: 'abonado a las entradas del periodo',
      icon: 'i-lucide-circle-check',
      color: 'text-success',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Compras por pagar',
      value: currency.format(entriesBalance.value),
      hint: 'saldo pendiente con proveedores',
      icon: 'i-lucide-clock',
      color: 'text-warning',
      loading: loadingSummary.value,
      globalOnly: false
    }
  ]

 
 all.push({
    label: 'Costo total',
    value: currency.format(allProductsTotals.value?.totalCost ?? 0),
    // Mismo criterio que /dashboardresultados: si hay piezas vendidas contra
    // capas de $0, el número está subvaluado y el rótulo tiene que decirlo.
    hint: hasZeroCostSales.value
      ? `⚠ incompleto: ${number.format(zeroCostUnits.value)} pieza(s) salieron sin costo`
      : 'de todos los productos vendidos',
    icon: 'i-lucide-receipt',
    color: hasZeroCostSales.value ? 'text-error' : 'text-warning',
    loading: loadingSummary.value,
    globalOnly: false
  })

  all.push({
    label: 'Venta total',
    value: currency.format(netSalesValue.value),
    hint: 'de todos los productos vendidos',
    icon: 'i-lucide-trending-up',
    color: 'text-info',
    loading: loadingSummary.value,
    globalOnly: false
  })
   all.push({
  label: 'Utilidad total',
  value: currency.format(allProductsNetProfit.value),
  hint: hasZeroCostSales.value
    ? `${allProductsProfitPct.value.toFixed(1)}% · ⚠ inflada: el costo está incompleto`
    : `${allProductsProfitPct.value.toFixed(1)}% sobre ventas totales`,
  icon: (allProductsNetProfit.value >= 0) ? 'i-lucide-circle-check' : 'i-lucide-alert-circle',
  color: (allProductsNetProfit.value >= 0) ? 'text-success' : 'text-error',
  loading: loadingSummary.value,
  globalOnly: false
})
  all.push({
    label: 'Total gastos Pagados',
    value: currency.format(totalExpensesPaid.value),
    hint: 'en el periodo',
    icon: 'i-lucide-circle-check',
    color: 'text-success',
    loading: loadingSummary.value,
    globalOnly: false
  })



 if (totalLoses.value < 0) {
    all.push({
      label: 'Pérdidas',
      value: currency.format(totalLoses.value),
      hint: 'en el periodo',
      icon: 'i-lucide-alert-circle',
      color: 'text-error',
      loading: loadingSummary.value,
      globalOnly: false
    })
  } else {
    all.push({
      label: 'Ganancias',
      value: currency.format(totalLoses.value),
      hint: 'en el periodo',
      icon: 'i-lucide-check-circle',
      color: 'text-success',
      loading: loadingSummary.value,
      globalOnly: false
    })
  }

all.push({
  label: 'Gastos fijos',
  value: currency.format(totalExpensesFijo.value),
  hint: 'sin IVA/retenciones · en el periodo',
  icon: 'i-lucide-home',
  color: 'text-warning',
  loading: loadingSummary.value,
  globalOnly: false
})





all.push({
  label: 'Gastos Fijos pagados',
  value: currency.format(totalExpensesPaidFijo.value),
  hint: 'en el periodo',
  icon: 'i-lucide-circle-check',
  color: 'text-success',
  loading: loadingSummary.value,
  globalOnly: false
})

all.push({
  label: 'Gastos Fijos pendientes',
  value: currency.format(totalExpensesPendingFijo.value),
  hint: 'por pagar',
  icon: 'i-lucide-clock',
  color: 'text-error',
  loading: loadingSummary.value,
  globalOnly: false
})

all.push({
  label: 'Gastos operativos',
  value: currency.format(totalExpensesOperativo.value),
  hint: 'sin IVA/retenciones · en el periodo',
  icon: 'i-lucide-wrench',
  color: 'text-warning',
  loading: loadingSummary.value,
  globalOnly: false
})

all.push({
  label: 'Gastos Operativos pagados',
  value: currency.format(totalExpensesPaidOperativo.value),
  hint: 'en el periodo',
  icon: 'i-lucide-circle-check',
  color: 'text-success',
  loading: loadingSummary.value,
  globalOnly: false
})

all.push({
  label: 'Gastos Operativos pendientes',
  value: currency.format(totalExpensesPendingOperativo.value),
  hint: 'por pagar',
  icon: 'i-lucide-clock',
  color: 'text-error',
  loading: loadingSummary.value,
  globalOnly: false
})





return selectedStoreId.value ? all.filter((m) => !m.globalOnly) : all

})



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
      
        <UButton v-if="canWrite" to="/productos/nuevo" icon="i-lucide-plus" color="primary">
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
  :disabled="isStoreScoped"
  class="w-64"
/>
<h2 v-if="!selectedStoreId && !isStoreScoped" class="flex items-center gap-2 font-semibold">
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
      :description="productsError"
    />

    <UAlert
      v-if="summaryError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar las métricas del periodo"
      :description="summaryError"
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
      <h2 class="text-sm font-semibold">Valor de inventario al corte</h2>
      <span class="ml-auto text-xs text-muted">{{ cutoffLabel }}</span>
    </div>
  </template>

  <p v-if="loadingSummary" class="text-xs text-muted py-2 text-center">Calculando…</p>
  <div v-else-if="monthlyInventory" class="grid gap-4 sm:grid-cols-3">
    <div>
      <p class="text-xs text-muted">Inventario al {{ cutoffLabel }}</p>
      <p class="mt-0.5 text-lg font-semibold text-success">
        {{ currency.format(monthlyInventory.endingInventoryValue) }}
      </p>
    </div>
  </div>
</UCard>

<!--<UCard class="sm:col-span-2 lg:col-span-3" :ui="{ body: 'p-3 sm:p-4' }">
  <template #header>
    <div class="flex items-center gap-2 py-0">
      <UIcon name="i-lucide-scale" class="size-4 text-primary" />
      <h2 class="text-sm font-semibold">Cómo se llegó al inventario final</h2>
      <span class="ml-auto text-xs text-muted">
        {{ reconciliationOpeningLabel }} → {{ cutoffLabel }}
      </span>
    </div>
  </template>

  <p v-if="loadingSummary" class="text-xs text-muted py-2 text-center">Calculando…</p>
  <div v-else-if="reconciliation">
    <div
      v-for="row in reconciliation.rows"
      :key="row.label"
      class="flex items-baseline justify-between gap-3 border-b border-default py-1.5"
    >
      <div class="min-w-0">
        <p class="text-sm">
          <span class="inline-block w-3 text-muted">{{ row.sign }}</span>{{ row.label }}
        </p>
        <p class="pl-3 text-xs text-muted">{{ row.detail }}</p>
      </div>
      <p
        class="shrink-0 text-sm font-medium tabular-nums"
        :class="row.amount < 0 ? 'text-error' : ''"
      >
        {{ currency.format(row.amount) }}
      </p>
    </div>

    <div class="flex items-baseline justify-between gap-3 pt-2.5">
      <p class="text-sm font-semibold">= Inventario al {{ cutoffLabel }}</p>
      <p class="shrink-0 text-lg font-semibold tabular-nums text-success">
        {{ currency.format(reconciliation.actual) }}
      </p>
    </div>

    <UAlert
      v-if="reconciliation.gap !== 0"
      class="mt-3"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      :title="`La cuenta no cierra por ${currency.format(reconciliation.gap)}`"
      description="Los renglones de arriba deberían sumar exactamente el inventario final."
    />

    <UAlert
      v-if="reconciliation.uncoveredUnits > 0"
      class="mt-3"
      color="warning"
      variant="soft"
      icon="i-lucide-package-x"
      :title="`${number.format(reconciliation.uncoveredUnits)} artículo(s) se vendieron sin existencia registrada`"
      :description="`Se costearon en ${currency.format(reconciliation.uncoveredValue)} con la compra que los cubrió después. Conviene capturar la entrada antes de la venta.`"
    />
  </div> 
</UCard>-->
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