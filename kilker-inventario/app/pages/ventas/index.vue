<!-- pages/ventas/index.vue -->
<script setup lang="ts">
import type { ApiSale, ApiSaleDetail } from '~/types/inventario'
import * as XLSX from 'xlsx'
const { sales, total, page, pageSize, pending, error, status, storeId, productId, from, to, search, refresh } = useSalesHistory()


// Asegúrate de que la importación sea correcta
import FiltroPeriodo from '~/components/FiltroPeriodo.vue'

useHead({ title: 'Historial de ventas · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { data: stores } = useStores()
const { data: products } = useProducts()

const apiFetch = useApiFetch()

const viewingId = ref<number | null>(null)
const detail = ref<ApiSaleDetail | null>(null)
const loadingDetail = ref(false)
const showDetailModal = ref(false)

// Estado compartido: refrescamos al entrar para no mostrar datos viejos.
onMounted(() => {
  refresh()
})

if (import.meta.client) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh()
    }
  })
}

const statusItems = [
  { label: 'Todas', value: 'todas' },
  { label: 'Emitidas', value: 'emitida' },
  { label: 'Anuladas', value: 'anulada' }
]
const storeItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])

const productItems = computed(() => [
  { label: 'Todos los productos', value: undefined },
  ...products.value.map((p) => ({ label: `${p.sku} — ${p.name}`, value: p.id }))
])
// El filtro de tienda usa 0 = todas; lo mapeamos al ref (undefined = todas).
const storeFilter = computed({
  get: () => storeId.value ?? 0,
  set: (v: number) => {
    storeId.value = v || undefined
  }
})

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short'
})
function fmtDate(s: string | null) {
  return s ? dateFmt.format(new Date(s)) : '—'
}

// Anulación (solo admin): confirmación inline con motivo.
const voidingId = ref<number | null>(null)
const voidReason = ref('')
const submittingVoid = ref(false)

function openVoid(sale: ApiSale) {
  voidingId.value = sale.id
  voidReason.value = ''
}
function cancelVoid() {
  voidingId.value = null
  voidReason.value = ''
}

async function confirmVoid(sale: ApiSale) {
  submittingVoid.value = true
  try {
    await apiFetch(`/api/sales/${sale.id}/void`, {
      method: 'POST',
      body: { reason: voidReason.value.trim() || undefined }
    })
    toast.add({
      title: `Venta ${sale.folio} anulada`,
      description: 'Se repuso el inventario.',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    cancelVoid()
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

// El EMPLEADO no anula: abre un ticket de corrección que el admin resolverá.
const requestingId = ref<number | null>(null)
const requestReason = ref('')
const submittingRequest = ref(false)

function openRequest(sale: ApiSale) {
  requestingId.value = sale.id
  requestReason.value = ''
}
function cancelRequest() {
  requestingId.value = null
  requestReason.value = ''
}

async function confirmRequest(sale: ApiSale) {
  if (!requestReason.value.trim()) {
    toast.add({ title: 'Escribe el motivo', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  submittingRequest.value = true
  try {
    await apiFetch('/api/tickets', {
      method: 'POST',
      body: { invoiceId: sale.id, reason: requestReason.value.trim() }
    })
    toast.add({
      title: 'Solicitud enviada',
      description: `Se abrió un ticket para anular ${sale.folio}. Un admin lo revisará.`,
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

async function openDetail(sale: ApiSale) {
  viewingId.value = sale.id
  detail.value = null
  showDetailModal.value = true
  loadingDetail.value = true
  try {
    detail.value = await apiFetch<ApiSaleDetail>(`/api/sales/${sale.id}`)
  } catch (e) {
    toast.add({
      title: 'No se pudo cargar el detalle',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
    showDetailModal.value = false
  } finally {
    loadingDetail.value = false
  }
}

const exportingAll = ref(false)
const exportingFiltered = ref(false)

// Hoja 1: resumen de ventas
function salesToSheet(rows: ApiSale[]) {
  return rows.map((s) => ({
    Folio: s.folio ?? '',
    Fecha: fmtDate(s.issuedAt),
    Sucursal: s.storeCode ?? '',
    Cliente: s.customerName ?? 'Sin cliente',
    'Productos (líneas)': s.itemCount,
    Total: Number(s.totalAmount),
    Canal: s.channel === 'en_linea' ? 'En línea' : 'Mostrador',
    Estado: s.status === 'anulada' ? 'Anulada' : 'Emitida',
    Creó: s.createdByName ?? ''
  }))
}

// Hoja 2: desglose línea por línea de cada ticket
function saleItemsToSheet(sales: ApiSale[]) {
  const rows: Record<string, any>[] = []
  for (const s of sales) {
    for (const it of s.items) {
      rows.push({
        Folio: s.folio ?? '',
        Fecha: fmtDate(s.issuedAt),
        Sucursal: s.storeCode ?? '',
        Cliente: s.customerName ?? 'Sin cliente',
        Producto: it.productName ?? '',
        SKU: it.productSku ?? '',
        Cantidad: Number(it.quantity),
        'Precio unitario': Number(it.unitPrice),
        'Total línea': Number(it.lineTotal),
        Estado: s.status === 'anulada' ? 'Anulada' : 'Emitida'
      })
    }
  }
  return rows
}

function downloadSalesWorkbook(sales: ApiSale[], filenamePrefix: string) {
  const workbook = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.json_to_sheet(salesToSheet(sales))
  summarySheet['!cols'] = [
    { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 22 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 18 }
  ]
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ventas')

  const itemsSheet = XLSX.utils.json_to_sheet(saleItemsToSheet(sales))
  itemsSheet['!cols'] = [
    { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 22 },
    { wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 10 }
  ]
  XLSX.utils.book_append_sheet(workbook, itemsSheet, 'Detalle de tickets')

  const fecha = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `${filenamePrefix}_${fecha}.xlsx`)
}

async function exportFiltered() {
  exportingFiltered.value = true
  try {
    const query: Record<string, any> = {}
    if (status.value !== 'todas') query.status = status.value
    if (storeId.value) query.storeId = storeId.value
    if (from.value) query.from = from.value
    if (to.value) query.to = to.value
    if (search.value) query.q = search.value
    if (productId.value) query.productId = productId.value

    const rows = await apiFetch<ApiSale[]>('/api/sales', { query })
    if (!rows.length) {
      toast.add({ title: 'Sin datos para exportar', color: 'warning', icon: 'i-lucide-info' })
      return
    }

    downloadSalesWorkbook(rows, 'ventas-filtradas')
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

async function exportAll() {
  exportingAll.value = true
  try {
    const query: Record<string, any> = {}
    if (storeId.value) query.storeId = storeId.value
    if (from.value) query.from = from.value
    if (to.value) query.to = to.value
    if (search.value) query.q = search.value
    if (productId.value) query.productId = productId.value

    const rows = await apiFetch<ApiSale[]>('/api/sales', { query })
    if (!rows.length) {
      toast.add({ title: 'Sin datos para exportar', color: 'warning', icon: 'i-lucide-info' })
      return
    }

    downloadSalesWorkbook(rows, 'ventas-con-desglose')
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
        <h1 class="text-2xl font-semibold">Historial de ventas</h1>
        <p class="text-sm text-muted">
          {{ sales.length }} venta(s)
          <template v-if="!isAdmin"> · tu sucursal</template>
        </p>
      </div>
        <div class="flex flex-wrap gap-2">

      <UButton to="/ventas/nueva" icon="i-lucide-plus" color="primary"> Nueva venta </UButton>
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
    Exportar con filtro
  </UButton>
        </div>
    </header>

    <div class="space-y-3">
      <!-- Asegúrate de que el nombre del componente coincida -->
      <FiltroPeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        :search-placeholder="'Buscar folio, sucursal, empleado, método de pago…'"
      />
      <div class="flex flex-wrap gap-3">
        <USelect v-model="status" :items="statusItems" class="w-44" />
        <USelect v-if="isAdmin" v-model="storeFilter" :items="storeItems" class="w-60" />
         <USelectMenu
      v-model="productId"
      :items="productItems"
      value-key="value"
      searchable
      placeholder="Buscar producto…"
      class="w-64"
    />
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

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Folio</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium">Cliente</th>
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium text-right">Prod.</th>
              <th class="px-4 py-3 font-medium text-right">Total</th>
              <th class="px-4 py-3 font-medium text-center">Canal</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium">Creó</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td :colspan="10" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!sales.length">
              <td :colspan="10" class="px-4 py-8 text-center text-muted">
                Sin ventas para el filtro actual.
              </td>
            </tr>
            <template v-for="s in sales" v-else :key="s.id">
              <tr class="hover:bg-elevated/50">
                <td class="px-4 py-3 font-mono text-xs">{{ s.folio }}</td>
                <td class="px-4 py-3 text-muted">{{ s.storeCode ?? '—' }}</td>
                <td class="px-4 py-3 text-muted">{{ s.customerName ?? 'Sin cliente' }}</td>
                <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(s.issuedAt) }}</td>
                <td class="px-4 py-3 text-right tabular-nums">{{ s.itemCount }}</td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ currency.format(Number(s.totalAmount)) }}
                </td>
                <td class="px-4 py-3 text-center">
                  <UBadge
                    :label="s.channel === 'en_linea' ? 'En línea' : 'Mostrador'"
                    :color="s.channel === 'en_linea' ? 'info' : 'neutral'"
                    variant="subtle"
                  />
                </td>
                <td class="px-4 py-3 text-center">
                  <UBadge
                    :label="s.status === 'anulada' ? 'Anulada' : 'Emitida'"
                    :color="s.status === 'anulada' ? 'error' : 'success'"
                    variant="subtle"
                  />
                </td>
                <td class="px-4 py-3 text-muted">{{ s.createdByName ?? '—' }}</td>
                <td class="px-4 py-3 text-right">
                   <div class="flex items-center justify-end gap-1">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-receipt"
                      @click="openDetail(s)"
                    />
                  <!-- Admin: anula directo -->
                  <UButton
                    v-if="isAdmin && s.status === 'emitida' && voidingId !== s.id"
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-ban"
                    @click="openVoid(s)"
                  >
                    Anular
                  </UButton>
                  <!-- Empleado: ya hay un ticket abierto para esta venta -->
                  <UBadge
                    v-else-if="!isAdmin && s.status === 'emitida' && s.pendingCorrection"
                    label="Esperando corrección"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-clock"
                  />
                  <!-- Empleado: solicita anulación (abre ticket) -->
                  <UButton
                    v-else-if="!isAdmin && s.status === 'emitida' && requestingId !== s.id"
                    size="xs"
                    color="warning"
                    variant="ghost"
                    icon="i-lucide-flag"
                    @click="openRequest(s)"
                  >
                    Solicitar anulación
                  </UButton>
                  <span v-else-if="s.status === 'anulada'" class="text-xs text-muted">—</span>
                </div>
                </td>
              </tr>
              <!-- Panel: empleado solicita anulación (abre ticket) -->
              <tr v-if="!isAdmin && requestingId === s.id" class="bg-elevated/40">
                <td :colspan="10" class="px-4 py-3">
                  <div class="flex flex-wrap items-start gap-3">
                    <div class="flex-1">
                      <p class="text-xs text-muted mb-1">
                        Solicitar anulación para <strong>{{ s.folio }}</strong>
                      </p>
                      <UInput
                        v-model="requestReason"
                        placeholder="Motivo de la anulación…"
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
                      <UButton
                        size="xs"
                        color="warning"
                        :loading="submittingRequest"
                        @click="confirmRequest(s)"
                      >
                        Enviar solicitud
                      </UButton>
                    </div>
                  </div>
                </td>
              </tr>
              <!-- Panel de confirmación de anulación (admin) -->
              <tr v-if="isAdmin && voidingId === s.id" class="bg-elevated/40">
                <td :colspan="10" class="px-4 py-3">
                  <div class="flex flex-wrap items-start gap-3">
                    <div class="flex-1">
                      <p class="text-xs text-muted mb-1">
                        Anular <strong>{{ s.folio }}</strong>
                      </p>
                      <UInput
                        v-model="voidReason"
                        placeholder="Motivo (opcional)…"
                        class="max-w-md"
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <UButton
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        :disabled="submittingVoid"
                        @click="cancelVoid"
                      >
                        Cancelar
                      </UButton>
                      <UButton
                        size="xs"
                        color="error"
                        :loading="submittingVoid"
                        @click="confirmVoid(s)"
                      >
                        Confirmar anulación
                      </UButton>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
       
      </div>
    </UCard>
     <div class="flex flex-col items-center gap-2">
          <p class="text-xs text-muted">Mostrando {{ sales.length }} de {{ total }} venta(s)</p>
          <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
        </div>
    <UModal v-model:open="showDetailModal">
  <template #content>
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-receipt" class="size-5 text-primary" />
          <h2 class="font-semibold font-mono">{{ detail?.folio ?? '' }}</h2>
          <UBadge
            v-if="detail"
            :label="detail.status === 'anulada' ? 'Anulada' : 'Emitida'"
            :color="detail.status === 'anulada' ? 'error' : 'success'"
            variant="subtle"
            class="ml-auto"
          />
        </div>
      </template>

      <p v-if="loadingDetail" class="text-sm text-muted py-8 text-center">Cargando…</p>

    <div v-else-if="detail" class="space-y-4">
  <!-- Datos generales -->
  <div class="grid gap-3 sm:grid-cols-2 text-sm">
    <div>
      <p class="text-muted">Sucursal</p>
      <p class="font-medium">{{ detail.storeCode }} · {{ detail.storeName }}</p>
    </div>
    <div>
      <p class="text-muted">Fecha</p>
      <p class="font-medium">{{ fmtDate(detail.issuedAt) }}</p>
    </div>
    <div>
      <p class="text-muted">Cliente</p>
      <p class="font-medium">{{ detail.customerName ?? 'Sin cliente' }}</p>
    </div>
    <div>
      <p class="text-muted">Canal</p>
      <p class="font-medium">{{ detail.channel === 'en_linea' ? 'En línea' : 'Mostrador' }}</p>
    </div>
    <div>
      <p class="text-muted">Método de pago</p>
      <p class="font-medium capitalize">{{ detail.paymentMethod }}</p>
    </div>
    <div>
      <p class="text-muted">Vendió</p>
      <p class="font-medium">{{ detail.createdByName ?? '—' }}</p>
    </div>
  </div>

  <p v-if="detail.note" class="text-sm text-muted italic">"{{ detail.note }}"</p>

  <USeparator />

  <!-- Líneas de producto: con scroll si hay muchas -->
  <div class="max-h-72 overflow-y-auto">
    <table class="w-full text-sm">
      <thead class="text-muted border-b border-default sticky top-0 bg-default">
        <tr class="text-left">
          <th class="py-2 font-medium">Producto</th>
          <th class="py-2 font-medium text-right">Cant.</th>
          <th class="py-2 font-medium text-right">P. unit.</th>
          <th class="py-2 font-medium text-right">Total</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-default">
        <tr v-for="it in detail.items" :key="it.id">
          <td class="py-2">
            <p class="font-medium">{{ it.productName ?? '—' }}</p>
            <p class="text-xs text-muted font-mono">{{ it.productSku ?? '—' }}</p>
          </td>
          <td class="py-2 text-right tabular-nums">{{ it.quantity }}</td>
          <td class="py-2 text-right tabular-nums">{{ currency.format(Number(it.unitPrice)) }}</td>
          <td class="py-2 text-right tabular-nums">{{ currency.format(Number(it.lineTotal)) }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <USeparator />

  <div class="flex justify-between text-lg font-semibold">
    <span>Total</span>
    <span class="tabular-nums">{{ currency.format(Number(detail.totalAmount)) }}</span>
  </div>

  <div class="space-y-1 text-sm">
  <div v-if="Number(detail.discountAmount) > 0" class="flex justify-between text-muted">
    <span>Subtotal</span>
    <span class="tabular-nums">{{ currency.format(Number(detail.subtotalAmount)) }}</span>
  </div>
  <div v-if="Number(detail.discountAmount) > 0" class="flex justify-between text-muted">
    <span>Descuento ({{ Number(detail.discountPct) }}%)</span>
    <span class="tabular-nums">-{{ currency.format(Number(detail.discountAmount)) }}</span>
  </div>
</div>

  <UAlert
    v-if="detail.status === 'anulada'"
    color="error"
    variant="soft"
    icon="i-lucide-ban"
    title="Venta anulada"
    :description="detail.voidReason ?? undefined"
  />
</div>

      <div class="flex justify-end pt-4">
        <UButton variant="ghost" color="neutral" @click="showDetailModal = false">Cerrar</UButton>
      </div>
    </UCard>
  </template>
</UModal>
  </UContainer>
</template>