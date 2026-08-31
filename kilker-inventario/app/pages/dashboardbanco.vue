<script setup lang="ts">
// ───────────────────────────────────────────────
//  DASHBOARD DE BANCO — /dashboardbanco
// ───────────────────────────────────────────────
// Nació como copia del dashboard de inventario y se quedó solo con la parte de
// dinero: ventas, compras, gastos y el libro de banco. De ahí que NO cargue el
// catálogo ni los productos más vendidos — la copia sí los traía, pero sus
// tarjetas ya no están y eran dos peticiones caras que nadie leía.
//
// ⚠️ Las tarjetas de arriba responden al periodo y a la sucursal; las de banco
// son el histórico completo. Ver el comentario de esa sección en el template.

// El flujo de dinero no es de la operación diaria de mostrador: lo ven quienes
// administran (empresa o sucursal) y el observador, en modo consulta.
//
// ⚠️ El candado de verdad son los endpoints (`/api/banks-movements` y
// `/api/dashboard/summary`); esto solo evita el rebote del guard.
definePageMeta({ requiresRole: ['admin', 'observador', 'admin_tienda'] })
useHead({ title: 'Dashboard Flujo · Inventario Kilker' })

const { data: stores } = useStores()
const { me, canWrite, isStoreScoped } = useMe()

// Todas las métricas agregadas en UNA petición (ver useDashboardSummary).
const {
  data: summary,
  pending: loadingSummary,
  error: summaryError,
  refresh: refreshSummary
} = useDashboardSummary()

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0
})
const number = new Intl.NumberFormat('es-MX')

// ───────────────────────────────────────────────
//  VENTAS: emitidas, cobradas y por cobrar
// ───────────────────────────────────────────────
// ⚠️ Esto es CARTERA, no banco. Lo que mueve el saldo bancario es el abono
// cuando entra; una venta a crédito no mueve un peso hasta que se cobra. Así que
// "Ventas cobradas" del periodo NO tiene por qué coincidir con los cobros
// asentados en el libro de dinero: un abono de hoy puede estar pagando una
// factura de hace tres meses.
const netSalesValue = computed(() => summary.value?.salesValue ?? 0)
const salesPaid = computed(() => summary.value?.salesPaid ?? 0)
const salesBalance = computed(() => summary.value?.salesBalance ?? 0)

// ───────────────────────────────────────────────
//  COMPRAS (entradas de stock)
// ───────────────────────────────────────────────
// Los agrega el servidor con SUM(); pagadas + por pagar = Compras.
const entryValue = computed(() => summary.value?.entriesValue ?? 0)
const entriesPaid = computed(() => summary.value?.entriesPaid ?? 0)
const entriesBalance = computed(() => summary.value?.entriesBalance ?? 0)

// ───────────────────────────────────────────────
//  GASTOS: subtotal (a pagar), pagado y pendiente
// ───────────────────────────────────────────────
// Vienen desglosados por tipo (Fijo/Operativo); esta pantalla los muestra
// sumados. El desglose por tipo está en el dashboard de inventario.
const EMPTY_BUCKET = { subtotal: 0, totalPaid: 0, balance: 0 }

const expensesByType = computed(
  () => summary.value?.expenses ?? { Fijo: EMPTY_BUCKET, Operativo: EMPTY_BUCKET }
)

const totalExpenses = computed(
  () => expensesByType.value.Fijo.subtotal + expensesByType.value.Operativo.subtotal
)
const totalExpensesPaid = computed(
  () => expensesByType.value.Fijo.totalPaid + expensesByType.value.Operativo.totalPaid
)
const totalExpensesPending = computed(
  () => expensesByType.value.Fijo.balance + expensesByType.value.Operativo.balance
)

// ───────────────────────────────────────────────
//  MOVIMIENTOS DE BANCO (histórico completo, sin periodo)
// ───────────────────────────────────────────────
const {
  globalBalance: bankGlobalBalance,
  conceptTotal: bankInitialBalance,
  pending: loadingBankTotals,
  error: bankTotalsError
} = useCashFlowTotals()

// ───────────────────────────────────────────────
//  FILTROS
// ───────────────────────────────────────────────
const periodFrom = ref<string | undefined>(undefined)
const periodTo = ref<string | undefined>(undefined)

const derivedMonth = computed(() => {
  const lastDay = periodTo.value ? new Date(periodTo.value) : new Date()
  if (periodTo.value) lastDay.setDate(lastDay.getDate() - 1)
  return `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}`
})

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

const activeStores = computed(() => stores.value.filter((s) => s.isActive).length)

// ───────────────────────────────────────────────
//  RECARGA
// ───────────────────────────────────────────────
// Una sola función y un solo disparador. Antes había tres caminos que llamaban
// a refreshAllData (montaje, watcher de sucursal, watcher de periodo) y además
// cada composable se auto-observaba, así que una carga del dashboard repetía
// el mismo fetch 3-5 veces.
const lastRefreshTime = ref(Date.now())

async function refreshAllData() {
  await refreshSummary({
    storeId: selectedStoreId.value || undefined,
    from: periodFrom.value,
    to: periodTo.value,
    month: derivedMonth.value
  })

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

// ───────────────────────────────────────────────
//  TARJETAS
// ───────────────────────────────────────────────
// `globalOnly` filtra las que solo tienen sentido viendo todas las sucursales.
// Hoy ninguna lo es; se conserva porque el filtro de abajo ya lo aplica y una
// tarjeta futura solo tiene que marcarlo.
const metricsSection2 = computed(() => {
  const all = [
    {
      label: 'Ventas totales',
      value: currency.format(netSalesValue.value),
      hint: 'emitidas en el periodo',
      icon: 'i-lucide-receipt',
      color: 'text-primary',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Ventas cobradas',
      value: currency.format(salesPaid.value),
      hint: 'abonado a las ventas del periodo',
      icon: 'i-lucide-circle-check',
      color: 'text-success',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Ventas por cobrar',
      value: currency.format(salesBalance.value),
      hint: 'saldo pendiente de los clientes',
      icon: 'i-lucide-clock',
      color: 'text-warning',
      loading: loadingSummary.value,
      globalOnly: false
    },
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
    },
    {
      label: 'Total Gastos',
      value: currency.format(totalExpenses.value),
      hint: 'en el periodo',
      icon: 'i-lucide-wrench',
      color: 'text-warning',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Total gastos Pagados',
      value: currency.format(totalExpensesPaid.value),
      hint: 'en el periodo',
      icon: 'i-lucide-circle-check',
      color: 'text-success',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Total gastos pendientes',
      value: currency.format(totalExpensesPending.value),
      hint: 'en el periodo',
      icon: 'i-lucide-clock',
      color: 'text-warning',
      loading: loadingSummary.value,
      globalOnly: false
    }
  ]

  return selectedStoreId.value ? all.filter((m) => !m.globalOnly) : all
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
      v-if="summaryError"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar las métricas del periodo"
      :description="summaryError"
    />

    <!-- Tarjetas de métricas -->
    <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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


    <section class="space-y-4">
      <!-- <h2 class="flex items-center gap-2 font-semibold">
        <UIcon name="i-lucide-landmark" class="size-5 text-primary" />
        Movimientos de banco
        <span class="ml-1 text-xs font-normal text-muted">histórico completo</span>
        <UButton
          to="/cuentas/movimientos"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-right"
          class="ml-auto"
        >
          Ver el libro
        </UButton>
      </h2> -->

      <UAlert
        v-if="bankTotalsError"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="No se pudieron cargar los movimientos de banco"
        :description="bankTotalsError"
      />

      <div v-else class="grid gap-4 sm:grid-cols-2">
         <UCard>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm text-muted">Saldos iniciales</p>
              <template v-if="loadingBankTotals">
                <USkeleton class="h-8 w-24 mt-1" />
                <USkeleton class="h-3 w-16 mt-2" />
              </template>
              <template v-else>
                <p
                  class="mt-1 text-2xl font-semibold"
                  :class="bankInitialBalance < 0 ? 'text-error' : ''"
                >
                  {{ currency.format(bankInitialBalance) }}
                </p>
                <p class="text-xs text-muted mt-1">
                  movimientos con concepto «Saldo inicial»
                </p>
              </template>
            </div>
            <UIcon name="i-lucide-flag" class="size-7 shrink-0 text-info" />
          </div>
        </UCard>
        <UCard>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm text-muted">Total de movimientos</p>
              <template v-if="loadingBankTotals">
                <USkeleton class="h-8 w-24 mt-1" />
                <USkeleton class="h-3 w-16 mt-2" />
              </template>
              <template v-else>
                <p
                  class="mt-1 text-2xl font-semibold"
                  :class="bankGlobalBalance < 0 ? 'text-error' : ''"
                >
                  {{ currency.format(bankGlobalBalance) }}
                </p>
                <p class="text-xs text-muted mt-1">
                  cobros, pagos y capturas manuales · todas las bolsas
                </p>
              </template>
            </div>
            <UIcon name="i-lucide-arrow-left-right" class="size-7 shrink-0 text-primary" />
          </div>
        </UCard>

       
      </div>
    </section>
  </UContainer>
</template>
