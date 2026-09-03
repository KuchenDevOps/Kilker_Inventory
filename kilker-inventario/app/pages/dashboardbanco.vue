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
// responden al periodo pero NO a la sucursal, porque el saldo vive por cuenta
// bancaria y una cuenta no es de ninguna tienda. Ver el comentario de esa
// sección más abajo.

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
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
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
// El bucket vacío replica la forma completa del que manda el servidor (no solo
// los campos que se pintaban): sin `totalToPay` aquí, el modo "Con IVA" no
// podría leerlo del fallback y TypeScript lo marcaría.
const EMPTY_BUCKET = {
  subtotal: 0,
  iva: 0,
  totalToPay: 0,
  totalPaid: 0,
  balance: 0,
  retentionIva: 0,
  retentionIsr: 0
}

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
//  BOTÓN "CON IVA / SIN IVA"
// ───────────────────────────────────────────────
// Igual que en /dashboardresultados: solo cambia la VISTA. No recarga nada ni
// toca la base — los importes que manda el servidor son los mismos en los dos
// modos.
//
// Mueve DOS tarjetas y nada más: "Ventas totales" y "Total Gastos". Todo lo
// demás se queda quieto porque ya es dinero real: lo cobrado y lo pendiente de
// ventas (ver abajo), lo pagado y lo pendiente de gastos (que ya se miden contra
// `total_to_pay`, o sea que YA llevan IVA), las compras (se costean sin IVA) y
// el libro de banco (dinero asentado, no una simulación).
//
// ⚠️ "Con IVA" NO significa lo mismo en las dos familias de tarjetas:
// - **Ventas:** es INFORMATIVO. El 16% no está en la BD (no hay CFDI) y
//   `invoices.total_amount` —lo cobrable— va sin él, así que aquí se suma con
//   `ivaOf`, que redondea a centavos igual que el resto de la app.
// - **Gastos:** es REAL. Lo que se paga es `totalToPay` (subtotal + IVA −
//   retenciones), columna GENERADA por Postgres, y por eso el modo con IVA
//   muestra ESE número y no `subtotal × 1.16`: con retenciones no coinciden, y
//   multiplicar aquí inventaría una cifra que no cuadra con los abonos.
const withIva = ref(false)

// ⚠️ El IVA solo toca "Ventas totales", que es lo emitido. **Cobrado y pendiente
// se quedan siempre sin IVA**: no se cobra con IVA ni se debe con IVA — un abono
// de `sale_payments` es dinero que de verdad entró contra
// `invoices.total_amount`, que va sin el 16%, y el saldo es lo que el cliente
// debe de verdad. Inflarlos aquí afirmaría que entró (o que falta) dinero que no
// existe, y este es el dashboard del dinero.
//
// Consecuencia buscada: en modo Con IVA, "cobrado + por cobrar" YA NO cuadra
// contra "Ventas totales" — la diferencia es justo el IVA informativo. Los hints
// de las tres tarjetas dicen en qué está cada una para que no se lea como un
// descuadre.
const displaySalesValue = computed(() =>
  withIva.value ? netSalesValue.value + ivaOf(netSalesValue.value) : netSalesValue.value
)
const salesIvaHint = computed(() => (withIva.value ? 'con IVA (16%) · informativo' : 'sin IVA'))

// ⚠️ En gastos solo cambia el TOTAL: `totalPaid` y `balance` ya se miden contra
// `total_to_pay`, o sea que siempre llevan IVA (ver el endpoint del summary).
// De ahí que "pagados + pendientes" solo cuadre contra el total en modo Con IVA;
// el hint lo dice para que la diferencia no se lea como un descuadre.
const displayTotalExpenses = computed(() =>
  withIva.value
    ? expensesByType.value.Fijo.totalToPay + expensesByType.value.Operativo.totalToPay
    : totalExpenses.value
)
const expensesTotalHint = computed(() =>
  withIva.value ? 'en el periodo · con IVA − retenciones' : 'en el periodo · sin IVA'
)

// ───────────────────────────────────────────────
//  MOVIMIENTOS DE BANCO
// ───────────────────────────────────────────────
// ⚠️ Responden al PERIODO pero no a la sucursal, y esto último no es un
// descuido: el saldo vive por CUENTA BANCARIA y una cuenta no pertenece a
// ninguna tienda (ver el encabezado de `GET /api/banks-movements`). Acotarlo por
// sucursal daría un número que no es el saldo de nada.
const {
  periodNet: bankPeriodNet,
  openingBalance: bankInitialBalance,
  openingIsConcept: bankOpeningIsConcept,
  pending: loadingBankTotals,
  error: bankTotalsError,
  refresh: refreshBankTotals
} = useCashFlowTotals()

// ───────────────────────────────────────────────
//  FILTROS
// ───────────────────────────────────────────────
const periodFrom = ref<string | undefined>(undefined)
const periodTo = ref<string | undefined>(undefined)

/**
 * Limpiar filtros: vuelve al periodo completo y a "todas las sucursales".
 *
 * ⚠️ No toca `selectedStoreId` si el rol está acotado a una sucursal: ahí el
 * selector va deshabilitado y su valor no es un filtro, es su tienda.
 */
const hasFilters = computed(
  () => !!periodFrom.value || !!periodTo.value || (!isStoreScoped.value && selectedStoreId.value !== 0)
)

function clearFilters() {
  periodFrom.value = undefined
  periodTo.value = undefined
  if (!isStoreScoped.value) selectedStoreId.value = 0
}

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
//  RÓTULOS DE LAS TARJETAS DE BANCO
// ───────────────────────────────────────────────
const dateLabel = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

/**
 * Corte del "Saldos iniciales", igual que el "Inventario inicial" del dashboard
 * de resultados: `from` es el instante en que ARRANCA la ventana, así que el
 * saldo de apertura queda al día ANTERIOR. Elegir agosto muestra el saldo al 31
 * de julio, no al 1 de agosto.
 */
const bankOpeningCutoffLabel = computed(() => {
  if (!periodFrom.value) return null
  const prevDay = new Date(periodFrom.value)
  prevDay.setDate(prevDay.getDate() - 1)
  return dateLabel.format(prevDay)
})

/**
 * Saldo al cierre = con qué dinero se termina el periodo: apertura + lo que se
 * movió dentro.
 *
 * ⚠️ Sin periodo NO se suma la apertura. Ahí "apertura" son los movimientos del
 * concepto «Saldo inicial», que ya vienen contados dentro del neto de todo el
 * libro, y sumarlos los contaría dos veces. Sin periodo el neto de todo el libro
 * YA ES el saldo de todas las bolsas (es la misma suma que hace `globalBalance`
 * en el endpoint), así que el cierre es él mismo.
 */
const bankClosingBalance = computed(() =>
  bankOpeningIsConcept.value
    ? bankPeriodNet.value
    : Math.round((bankInitialBalance.value + bankPeriodNet.value) * 100) / 100
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
  // Las dos en paralelo: son la misma pantalla y no dependen una de la otra.
  // ⚠️ Los totales de banco NO reciben `storeId` a propósito (ver su sección).
  await Promise.all([
    refreshSummary({
      storeId: selectedStoreId.value || undefined,
      from: periodFrom.value,
      to: periodTo.value,
      month: derivedMonth.value
    }),
    refreshBankTotals({ from: periodFrom.value, to: periodTo.value })
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
      value: currency.format(displaySalesValue.value),
      hint: `emitidas en el periodo · ${salesIvaHint.value}`,
      icon: 'i-lucide-receipt',
      color: 'text-primary',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Ventas cobradas',
      value: currency.format(salesPaid.value),
      hint: 'abonado a las ventas del periodo · dinero real, sin IVA',
      icon: 'i-lucide-circle-check',
      color: 'text-success',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Ventas por cobrar',
      value: currency.format(salesBalance.value),
      hint: 'saldo pendiente de los clientes · sin IVA',
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
      label: withIva.value ? 'Total Gastos a pagar' : 'Total Gastos',
      value: currency.format(displayTotalExpenses.value),
      hint: expensesTotalHint.value,
      icon: 'i-lucide-wrench',
      color: 'text-warning',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Total gastos Pagados',
      value: currency.format(totalExpensesPaid.value),
      hint: 'en el periodo · abonado sobre lo pagable (con IVA)',
      icon: 'i-lucide-circle-check',
      color: 'text-success',
      loading: loadingSummary.value,
      globalOnly: false
    },
    {
      label: 'Total gastos pendientes',
      value: currency.format(totalExpensesPending.value),
      hint: 'en el periodo · saldo sobre lo pagable (con IVA)',
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
      <!-- Solo cambia la vista de ventas y gastos: no recarga nada. -->
      <BotonIva
        v-model="withIva"
        title="Ventas y gastos con IVA (16%). En ventas es informativo; en gastos es lo que se paga (IVA − retenciones)."
      />
      <BotonLimpiarFiltros :active="hasFilters" @clear="clearFilters" />
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
                <!-- Con periodo es el saldo de apertura (todo lo asentado antes
                     de arrancar); sin periodo no hay "antes", así que son los
                     movimientos del concepto «Saldo inicial». -->
                <p class="text-xs text-muted mt-1">
                  {{
                    bankOpeningIsConcept
                      ? 'movimientos con concepto «Saldo inicial»'
                      : `saldo acumulado al ${bankOpeningCutoffLabel}`
                  }}
                </p>
              </template>
            </div>
            <UIcon name="i-lucide-flag" class="size-7 shrink-0 text-info" />
          </div>
        </UCard>
        <UCard>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm text-muted">Saldo al cierre</p>
              <template v-if="loadingBankTotals">
                <USkeleton class="h-8 w-24 mt-1" />
                <USkeleton class="h-3 w-16 mt-2" />
              </template>
              <template v-else>
                <!-- Con qué dinero se termina el periodo: apertura + lo movido
                     dentro. Sin periodo, el neto de todo el libro ya es el saldo. -->
                <p
                  class="mt-1 text-2xl font-semibold"
                  :class="bankClosingBalance < 0 ? 'text-error' : ''"
                >
                  {{ currency.format(bankClosingBalance) }}
                </p>
                <p class="text-xs text-muted mt-1">
                  {{ bankOpeningIsConcept ? 'movimientos del histórico' : 'movimientos del periodo' }}
                  <span class="tabular-nums">{{ currency.format(bankPeriodNet) }}</span>
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
