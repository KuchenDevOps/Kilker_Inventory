<script setup lang="ts">
import * as XLSX from 'xlsx'
import {
  ENTRY_PAYMENT_STATUS_LABELS,
  PAYMENT_LABELS,
  type ApiEntryPayment,
  type ApiMovement,
  type EntryPaymentStatus,
  type PaymentMethod
} from '~/types/inventario'

useHead({ title: 'Historial de entradas · Inventario Kilker' })

const { me, canWrite, seesAllStores } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { movements, total, totals, page, pageSize, pending, error, storeId, from, to, search, refresh } = useMovementsHistory()


const { data: stores } = useStores()
const toast = useToast()
const apiFetch = useApiFetch()

onMounted(() => {
  refresh()
})

const storeItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])
const storeFilter = computed({
  get: () => storeId.value ?? 0,
  set: (v: number) => {
    storeId.value = v || undefined
  }
})

const qtyFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 })
const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

// ───────────────────────────────────────────────
//  LIMPIAR FILTROS
// ───────────────────────────────────────────────
// ⚠️ Viven en `useState` (useMovementsHistory): son compartidos y sobreviven a
// la navegación, así que un periodo viejo sigue aplicado al volver. Se limpian
// en la misma tick para disparar UNA sola recarga.
const hasFilters = computed(
  () => !!search.value.trim() || !!from.value || !!to.value || storeId.value != null
)

function clearFilters() {
  search.value = ''
  from.value = undefined
  to.value = undefined
  storeId.value = undefined
}

// ───────────────────────────────────────────────
//  SUMATORIA DEL FILTRO (tarjeta)
// ───────────────────────────────────────────────
// ⚠️ La calcula el SERVIDOR sobre todo el filtro. Sumar `movements` daría el
// total de la página visible y cambiaría al paginar. Las entradas anuladas no
// suman (su mercancía se revirtió), pero se informan para que la tarjeta cuadre
// con el listado, que sí las muestra.
const totalHint = computed(() => {
  const n = totals.value.activeCount
  const base = `${n} entrada${n === 1 ? '' : 's'} · costo sin IVA`
  if (!totals.value.voidedCount) return base
  const v = totals.value.voidedCount
  return `${base} · ${v} anulada${v === 1 ? '' : 's'} fuera (${currency.format(totals.value.voidedAmount)})`
})

// Folio, Fecha, Producto, Sucursal, Cantidad, Total, Factura prov., Fecha
// factura, Registró y Pago; + Acciones para quien pueda escribir (admin anula
// directo, empleado solicita corrección). Se usa en los colspan de las filas
// de estado y de los paneles inline.
const colCount = computed(() => (canWrite.value ? 11 : 10))
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return dateFmt.format(d)
}
// ─── Asignación masiva de cuenta (corrección / relleno del histórico) ───
// Los pagos en efectivo NO cuentan: no llevan cuenta ni deben llevarla.
const bankPaymentCount = computed(
  () => payments.value.filter((p) => p.method !== 'efectivo').length
)
const assignedAccountCount = computed(
  () => payments.value.filter((p) => p.method !== 'efectivo' && p.accountId != null).length
)

const dayFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })
function fmtDay(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(`${s}T00:00:00`)
  if (isNaN(d.getTime())) return '—'
  return dayFmt.format(d)
}

// ───────────────────────────────────────────────
//  SOLICITUD DE CORRECCIÓN (empleado)
// ───────────────────────────────────────────────
// El empleado no anula ni edita: abre un ticket que el admin resuelve en
// /tickets, igual que en ventas. Antes existía aquí un modal "Editar entrada"
// que hacía PATCH sobre el kardex; se eliminó porque `stock_movements` es
// append-only (trigger de la migración 0001) y editar la fila en sitio o
// reventaba o rompía la trazabilidad.
const requestingId = ref<number | null>(null)
const requestReason = ref('')
const submittingRequest = ref(false)

function openRequest(m: ApiMovement) {
  requestingId.value = m.id
  requestReason.value = ''
}
function cancelRequest() {
  requestingId.value = null
  requestReason.value = ''
}

async function confirmRequest(m: ApiMovement) {
  if (!requestReason.value.trim()) {
    toast.add({ title: 'Escribe el motivo', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  submittingRequest.value = true
  try {
    await apiFetch('/api/tickets', {
      method: 'POST',
      body: { movementId: m.id, reason: requestReason.value.trim() }
    })
    toast.add({
      title: 'Solicitud enviada',
      description: `Se abrió un ticket para anular la entrada ${m.folio ?? ''}. Un admin lo revisará.`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    cancelRequest()
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo enviar la solicitud',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submittingRequest.value = false
  }
}

const voidingId = ref<number | null>(null)
const voidReason = ref('')
const submittingVoid = ref(false)

function openVoid(m: (typeof movements.value)[number]) {
  voidingId.value = m.id
  voidReason.value = ''
}
function cancelVoidPanel() {
  voidingId.value = null
  voidReason.value = ''
}

async function confirmVoid(m: (typeof movements.value)[number]) {
  submittingVoid.value = true
  try {
    const res = await apiFetch<{ ok: boolean; deletedPayments: number }>(
      `/api/movements/${m.id}/void`,
      {
        method: 'POST',
        body: { reason: voidReason.value.trim() || undefined }
      }
    )
    const borrados = res?.deletedPayments ?? 0
    toast.add({
      title: 'Entrada anulada',
      description:
        borrados > 0
          ? `Se descontó el inventario y se borraron ${borrados} pago(s).`
          : 'Se descontó el inventario.',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    cancelVoidPanel()
    await refresh()
    await refreshNuxtData('products')
  } catch (e) {
    toast.add({
      title: 'No se pudo anular',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submittingVoid.value = false
  }
}

// ───────────────────────────────────────────────
//  MODAL DE PAGOS DE LA ENTRADA
// ───────────────────────────────────────────────
// El pagable es la entrada misma: su total es el costo limpio, sin IVA ni
// retenciones (a diferencia de gastos). Tampoco se captura quién paga: las
// entradas siempre las cubre la misma empresa.
const viewingMovement = ref<ApiMovement | null>(null)
const showPaymentsModal = ref(false)
const payments = ref<ApiEntryPayment[]>([])
const loadingPayments = ref(false)
const submittingPayment = ref(false)

const paymentMethodItems = (Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((v) => ({
  label: PAYMENT_LABELS[v],
  value: v
}))

const PAYMENT_STATUS_COLORS: Record<EntryPaymentStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  pagado: 'success',
  parcial: 'warning',
  pendiente: 'error',
  anulada: 'neutral'
}

const paymentForm = reactive({
  amount: undefined as number | undefined,
  paidAt: '',
  method: 'efectivo' as PaymentMethod,
  /** null = efectivo. Lo llena SelectorCuentaPago. */
  accountId: null as number | null,
  note: ''
})

async function openPayments(m: ApiMovement) {
  viewingMovement.value = m
  showPaymentsModal.value = true
  Object.assign(paymentForm, {
    amount: undefined,
    paidAt: new Date().toISOString().slice(0, 10),
    method: 'efectivo',
    accountId: null,
    note: ''
  })
  await refreshPayments()
}

async function refreshPayments() {
  if (!viewingMovement.value) return
  loadingPayments.value = true
  try {
    payments.value = await apiFetch<ApiEntryPayment[]>(
      `/api/movements/${viewingMovement.value.id}/payments`
    )
  } catch (e) {
    toast.add({
      title: 'No se pudieron cargar los pagos',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    loadingPayments.value = false
  }
}

const canSubmitPayment = computed(
  () =>
    canWrite.value &&
    !!viewingMovement.value &&
    !viewingMovement.value.voided &&
    (paymentForm.amount ?? 0) > 0 &&
    paymentForm.paidAt.length > 0 &&
    isPaymentAccountValid(paymentForm.method, paymentForm.accountId) &&
    // Mismo tope que aplica el servidor; aquí solo evita el viaje perdido.
    (paymentForm.amount ?? 0) <= viewingMovement.value.balance + 0.01
)

async function submitPayment() {
  if (!canSubmitPayment.value || !viewingMovement.value) return
  submittingPayment.value = true
  try {
    await apiFetch(`/api/movements/${viewingMovement.value.id}/payments`, {
      method: 'POST',
      body: {
        amount: paymentForm.amount,
        paidAt: paymentForm.paidAt,
        method: paymentForm.method,
        accountId: paymentForm.accountId,
        note: paymentForm.note.trim() || undefined
      }
    })
    toast.add({ title: 'Pago registrado', color: 'success', icon: 'i-lucide-circle-check' })
    // La cuenta y el método NO se limpian: varios abonos seguidos casi siempre
    // salen de la misma cuenta.
    Object.assign(paymentForm, { amount: undefined, note: '' })
    await refreshPayments()
    await refresh()
    // La fila del listado trae el saldo recalculado; hay que reapuntar el
    // modal a ella o seguiría mostrando el saldo viejo.
    const updated = movements.value.find((x) => x.id === viewingMovement.value?.id)
    if (updated) viewingMovement.value = updated
  } catch (e) {
    toast.add({
      title: 'No se pudo registrar el pago',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submittingPayment.value = false
  }
}

const exportingFiltered = ref(false)
const exportingAll = ref(false)

function movementsToSheet(rows: any[]) {
  return rows.map((m) => ({
    Folio: m.folio ?? '',
    Fecha: fmtDate(m.createdAt),
    Producto: m.productName ?? '',
    SKU: m.productSku ?? '',
    Sucursal: m.storeCode ?? '',
    Cantidad: Number(m.quantity),
    Unidad: m.unit ?? '',
    'Valor Total': Number(m.totalValue),
    'Factura Proveedor': m.supplierInvoiceNumber ?? '',
    'Fecha Factura': fmtDay(m.supplierInvoiceDate),
    'Registró': m.createdByName ?? '',
    Estado: m.voided ? 'Anulada' : 'Activa',
    Pagado: Number(m.totalPaid ?? 0),
    Saldo: Number(m.balance ?? 0),
    'Estado de pago': ENTRY_PAYMENT_STATUS_LABELS[m.paymentStatus as EntryPaymentStatus] ?? ''
  }))
}

function downloadWorkbook(rows: any[], filenamePrefix: string) {
  const data = movementsToSheet(rows)
  const worksheet = XLSX.utils.json_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Entradas')

  worksheet['!cols'] = [
    { wch: 10 }, { wch: 18 }, { wch: 25 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 14 },
    { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }
  ]

  const fecha = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `${filenamePrefix}_${fecha}.xlsx`)
}

// Exporta respetando los filtros activos (búsqueda, fechas, sucursal)
async function exportFiltered() {
  exportingFiltered.value = true
  try {
    const query: Record<string, any> = {}
    if (storeId.value) query.storeId = storeId.value
    if (from.value) query.from = from.value
    if (to.value) query.to = to.value
    if (search.value) query.q = search.value

  const rows = await apiFetch<any[]>('/api/movements', { query })
    if (!rows.length) {
      toast.add({ title: 'Sin datos para exportar', color: 'warning', icon: 'i-lucide-info' })
      return
    }
    downloadWorkbook(rows, 'entradas-filtradas')
  } catch (e) {
    toast.add({
      title: 'No se pudo exportar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    exportingFiltered.value = false
  }
}

// Exporta TODAS las entradas, ignorando filtros de fecha/búsqueda/sucursal
async function exportAll() {
  exportingAll.value = true
  try {
    // Sin query: el endpoint devuelve el arreglo completo, sin filtros.
    const rows = await apiFetch<any[]>('/api/movements')
    if (!rows.length) {
      toast.add({ title: 'Sin datos para exportar', color: 'warning', icon: 'i-lucide-info' })
      return
    }
    downloadWorkbook(rows, 'entradas-todas')
  } catch (e) {
    toast.add({
      title: 'No se pudo exportar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    exportingAll.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 class="text-2xl font-semibold">Historial de entradas</h1>
    <p class="text-sm text-muted">
      {{ movements.length }} entrada(s)
      <template v-if="!seesAllStores"> · tu sucursal</template>
    </p>
  </div>
  <div class="flex flex-wrap gap-2">
   
    <UButton
      icon="i-lucide-file-spreadsheet"
      color="neutral"
      variant="subtle"
      :loading="exportingAll"
      @click="exportAll"
    >
      Exportar todo
    </UButton>
        <UButton
      icon="i-lucide-file-spreadsheet"
      color="neutral"
      variant="subtle"
      :loading="exportingFiltered"
      @click="exportFiltered"
    >
      Exportar con Filtro
    </UButton>
    <UButton v-if="canWrite" to="/movimientos/entrada" icon="i-lucide-plus" color="primary">
      Nueva entrada
    </UButton>
  </div>
</header>

    <div class="space-y-3">
      <FiltroPeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        search-placeholder="Buscar producto, SKU, factura, sucursal…"
      />
      <div class="flex flex-wrap items-center gap-3">
        <USelect v-if="seesAllStores" v-model="storeFilter" :items="storeItems" class="w-60" />
        <BotonLimpiarFiltros :active="hasFilters" @clear="clearFilters" />
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudo cargar el historial"
      :description="error"
    />
    <!-- Sumatoria del filtro completo (la calcula el servidor, no la página). -->
    <div class="grid gap-3 sm:grid-cols-2">
      <TarjetaTotal
        label="Total de entradas"
        icon="i-lucide-package-plus"
        :amount="totals.activeAmount"
        :hint="totalHint"
        :loading="pending"
      />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Folio</th>
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium">Producto</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium text-right">Cantidad</th>
              <th class="px-4 py-3 font-medium text-right">Total</th>
              <th class="px-4 py-3 font-medium">Factura prov.</th>
              <th class="px-4 py-3 font-medium">Fecha factura</th>
              <th class="px-4 py-3 font-medium">Registró</th>
              <th class="px-4 py-3 font-medium">Pago</th>
              <th v-if="canWrite" class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
       <tbody class="divide-y divide-default">
  <tr v-if="pending">
    <td :colspan="colCount" class="px-4 py-8 text-center text-muted">Cargando…</td>
  </tr>
  <tr v-else-if="!movements.length">
    <td :colspan="colCount" class="px-4 py-8 text-center text-muted">
      Sin entradas para el filtro actual.
    </td>
  </tr>
  <template v-for="m in movements" v-else :key="m.id">
    <tr class="hover:bg-elevated/50" :class="{ 'opacity-50': m.voided }">
      <td class="px-4 py-3 font-mono text-xs">{{ m.folio ?? '-' }}</td>
      <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(m.createdAt) }}</td>
      <td class="px-4 py-3">
        <div class="font-medium">{{ m.productName ?? '—' }}</div>
        <div class="font-mono text-xs text-muted">{{ m.productSku ?? '—' }}</div>
      </td>
      <td class="px-4 py-3 text-muted">{{ m.storeCode ?? '—' }}</td>
      <td class="px-4 py-3 text-right tabular-nums">
        {{ qtyFmt.format(Number(m.quantity)) }}
        <span class="text-muted">{{ m.unit ?? '' }}</span>
      </td>
      <td class="px-4 py-3 text-right tabular-nums">
        {{ currency.format(Number(m.totalValue)) }}
      </td>
      <td class="px-4 py-3 text-muted">{{ m.supplierInvoiceNumber ?? '—' }}</td>
      <td class="px-4 py-3 text-muted whitespace-nowrap">
        {{ fmtDay(m.supplierInvoiceDate) }}
      </td>
      <td class="px-4 py-3 text-muted">{{ m.createdByName ?? '—' }}</td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-2 whitespace-nowrap">
          <UBadge
            :label="ENTRY_PAYMENT_STATUS_LABELS[m.paymentStatus]"
            :color="PAYMENT_STATUS_COLORS[m.paymentStatus]"
            variant="subtle"
          />
          <span v-if="m.paymentStatus === 'parcial'" class="text-xs text-muted tabular-nums">
            resta {{ currency.format(m.balance) }}
          </span>
          <!-- Va aquí y no en "Acciones" porque esa columna es solo-admin y el
               empleado también registra pagos. -->
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-wallet"
            :title="m.voided ? 'Entrada anulada' : 'Ver pagos'"
            @click="openPayments(m)"
          />
        </div>
      </td>
      <td v-if="canWrite" class="px-4 py-3 text-right">
        <div v-if="m.voided" class="flex justify-end">
          <UBadge label="Anulada" color="error" variant="subtle" size="xs" />
        </div>
        <div v-else-if="m.pendingCorrection" class="flex justify-end">
          <UBadge label="Corrección pendiente" color="warning" variant="subtle" size="xs" />
        </div>
        <!-- El admin anula directo; el empleado solicita y el admin resuelve. -->
        <div v-else class="flex items-center justify-end gap-1">
          <UButton
            v-if="isAdmin && voidingId !== m.id"
            size="xs"
            color="error"
            variant="ghost"
            icon="i-lucide-ban"
            title="Anular entrada"
            @click="openVoid(m)"
          />
          <UButton
            v-else-if="!isAdmin && requestingId !== m.id"
            size="xs"
            color="warning"
            variant="ghost"
            icon="i-lucide-message-square-warning"
            title="Solicitar corrección"
            @click="openRequest(m)"
          />
        </div>
      </td>
    </tr>
    <!-- Panel de solicitud de corrección (empleado) -->
    <tr v-if="!isAdmin && requestingId === m.id" class="bg-elevated/40">
      <td :colspan="colCount" class="px-4 py-3">
        <div class="flex flex-wrap items-start gap-3">
          <div class="flex-1">
            <p class="text-xs text-muted mb-1">
              Solicitar corrección de <strong>{{ m.productName }}</strong>
              ({{ qtyFmt.format(Number(m.quantity)) }} {{ m.unit }}) · folio
              <span class="font-mono">{{ m.folio ?? '—' }}</span>
            </p>
            <UInput
              v-model="requestReason"
              placeholder="Motivo (obligatorio): qué está mal en esta entrada…"
              class="max-w-md"
            />
          </div>
          <div class="flex items-center gap-2">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="submittingRequest"
              @click="cancelRequest"
            >
              Cancelar
            </UButton>
            <UButton size="xs" color="warning" :loading="submittingRequest" @click="confirmRequest(m)">
              Enviar solicitud
            </UButton>
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          No anula nada todavía: abre un ticket para que un administrador lo revise. Si lo
          aprueba, la entrada se anula y tendrás que volver a capturarla corregida.
        </p>
      </td>
    </tr>
    <!-- Panel de confirmación de anulación -->
    <tr v-if="isAdmin && voidingId === m.id" class="bg-elevated/40">
      <td :colspan="colCount" class="px-4 py-3">
        <div class="flex flex-wrap items-start gap-3">
          <div class="flex-1">
            <p class="text-xs text-muted mb-1">
              Anular entrada de <strong>{{ m.productName }}</strong> ({{ m.quantity }} {{ m.unit }})
            </p>
            <UInput v-model="voidReason" placeholder="Motivo (opcional)…" class="max-w-md" />
          </div>
          <div class="flex items-center gap-2">
            <UButton size="xs" color="neutral" variant="ghost" :disabled="submittingVoid" @click="cancelVoidPanel">
              Cancelar
            </UButton>
            <UButton size="xs" color="error" :loading="submittingVoid" @click="confirmVoid(m)">
              Confirmar anulación
            </UButton>
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          Descuenta la cantidad del inventario. Solo es posible si aún no se ha vendido/transferido ese stock.
        </p>
        <p v-if="m.totalPaid > 0" class="mt-1 text-xs text-error">
          Se borrarán los pagos registrados ({{ currency.format(m.totalPaid) }}): la mercancía se
          devuelve, así que ese dinero deja de deberse.
        </p>
      </td>
    </tr>
  </template>
</tbody>
        </table>
      </div>
    </UCard>


    <div class="flex flex-col items-center gap-2">
      <p class="text-xs text-muted">Mostrando {{ movements.length }} de {{ total }} entrada(s)</p>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>

    <!-- Pagos de la entrada -->
    <UModal v-model:open="showPaymentsModal">
      <template #content>
        <UCard :ui="{ body: 'max-h-[75vh] overflow-y-auto' }">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-wallet" class="size-5 text-primary" />
              <div class="leading-tight">
                <h2 class="font-semibold">{{ viewingMovement?.productName ?? 'Entrada' }}</h2>
                <p class="font-mono text-xs text-muted">{{ viewingMovement?.folio ?? '—' }}</p>
              </div>
              <UBadge
                v-if="viewingMovement"
                :label="ENTRY_PAYMENT_STATUS_LABELS[viewingMovement.paymentStatus]"
                :color="PAYMENT_STATUS_COLORS[viewingMovement.paymentStatus]"
                variant="subtle"
                class="ml-auto"
              />
            </div>
          </template>

          <div v-if="viewingMovement" class="space-y-5">
            <!-- Datos de la entrada -->
            <div class="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <p class="text-muted text-xs">Sucursal</p>
                <p class="font-medium">{{ viewingMovement.storeCode ?? '—' }}</p>
              </div>
              <div>
                <p class="text-muted text-xs">Factura del proveedor</p>
                <p class="font-medium">{{ viewingMovement.supplierInvoiceNumber ?? '—' }}</p>
              </div>
              <div>
                <p class="text-muted text-xs">Cantidad</p>
                <p class="font-medium tabular-nums">
                  {{ qtyFmt.format(Number(viewingMovement.quantity)) }}
                  <span class="text-muted">{{ viewingMovement.unit ?? '' }}</span>
                </p>
              </div>
              <div>
                <p class="text-muted text-xs">Costo unitario</p>
                <p class="font-medium tabular-nums">
                  {{ currency.format(Number(viewingMovement.unitValue)) }}
                </p>
              </div>
            </div>

            <USeparator />

            <!-- Resumen de pago -->
            <div class="grid gap-3 sm:grid-cols-3 text-sm rounded-lg bg-elevated/40 px-4 py-3">
              <div>
                <p class="text-muted text-xs">Total a pagar</p>
                <p class="font-medium tabular-nums">
                  {{ currency.format(viewingMovement.totalToPay) }}
                </p>
              </div>
              <div>
                <p class="text-muted text-xs">Pagado</p>
                <p class="font-medium tabular-nums text-success">
                  {{ currency.format(viewingMovement.totalPaid) }}
                </p>
              </div>
              <div>
                <p class="text-muted text-xs">Saldo pendiente</p>
                <p class="font-medium tabular-nums text-error">
                  {{ currency.format(viewingMovement.balance) }}
                </p>
              </div>
            </div>
            <p class="text-xs text-muted">
              El total es el costo de la entrada, sin IVA ni retenciones.
            </p>

            <AsignarCuentaPagos
              v-if="viewingMovement"
              :endpoint="`/api/movements/${viewingMovement.id}`"
              :bank-payment-count="bankPaymentCount"
              :assigned-count="assignedAccountCount"
              @done="refreshPayments"
            />

            <!-- Historial de pagos -->
            <div>
              <h3 class="text-sm font-semibold mb-2">Historial de pagos</h3>
              <p v-if="loadingPayments" class="text-sm text-muted py-4 text-center">Cargando…</p>
              <p v-else-if="!payments.length" class="text-sm text-muted py-4 text-center">
                Sin pagos registrados todavía.
              </p>
              <ul v-else class="divide-y divide-default text-sm">
                <li v-for="p in payments" :key="p.id" class="py-2">
                  <p class="font-medium tabular-nums">{{ currency.format(Number(p.amount)) }}</p>
                  <p class="text-xs text-muted">
                    {{ fmtDay(p.paidAt) }} · {{ PAYMENT_LABELS[p.method] }}
                    <span v-if="p.createdByName"> · {{ p.createdByName }}</span>
                    <span v-if="p.accountLabel"> · {{ p.accountLabel }}</span>
                    <span v-else-if="p.method !== 'efectivo'" class="text-warning">
                      · sin cuenta
                    </span>
                  </p>
                  <p v-if="p.note" class="text-xs text-muted italic">"{{ p.note }}"</p>
                </li>
              </ul>
            </div>

            <!-- Una entrada anulada no admite pagos: la anulación ya borró los suyos. -->
            <UAlert
              v-if="viewingMovement.voided"
              color="neutral"
              variant="soft"
              icon="i-lucide-ban"
              title="Entrada anulada"
              description="La mercancía se devolvió, así que no hay nada que pagar."
            />

            <template v-else-if="canWrite && viewingMovement.balance > 0">
              <USeparator />

              <!-- Alta de pago (el observador solo ve el historial) -->
              <div class="space-y-3">
                <h3 class="text-sm font-semibold">Registrar pago</h3>
                <div class="grid gap-3 sm:grid-cols-2">
                  <UFormField label="Monto">
                    <UInputNumber
                      v-model="paymentForm.amount"
                      :min="0"
                      :max="viewingMovement.balance"
                      :step="0.01"
                      :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
                      :placeholder="`máx. ${viewingMovement.balance.toFixed(2)}`"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="Fecha de pago">
                    <UInput v-model="paymentForm.paidAt" type="date" class="w-full" />
                  </UFormField>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <UFormField label="Método">
                    <USelect v-model="paymentForm.method" :items="paymentMethodItems" class="w-full" />
                  </UFormField>
                  <SelectorCuentaPago
                    v-model="paymentForm.accountId"
                    :method="paymentForm.method"
                  />
                </div>
                <div class="grid gap-3">
                  <UFormField label="Nota (opcional)">
                    <UInput v-model="paymentForm.note" placeholder="Referencia, folio…" class="w-full" />
                  </UFormField>
                </div>
                <div class="flex justify-end">
                  <UButton
                    icon="i-lucide-plus"
                    color="primary"
                    :loading="submittingPayment"
                    :disabled="!canSubmitPayment"
                    @click="submitPayment"
                  >
                    Agregar pago
                  </UButton>
                </div>
              </div>
            </template>

            <UAlert
              v-else-if="viewingMovement.balance <= 0"
              color="success"
              variant="soft"
              icon="i-lucide-circle-check"
              title="Entrada completamente pagada"
            />
          </div>

          <div class="flex justify-end pt-4">
            <UButton variant="ghost" color="neutral" @click="showPaymentsModal = false">
              Cerrar
            </UButton>
          </div>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>