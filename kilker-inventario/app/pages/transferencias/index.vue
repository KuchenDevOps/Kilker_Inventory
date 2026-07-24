<script setup lang="ts">
import { TRANSFER_STATUS_LABELS, UNIT_LABELS ,  type ApiTransfer, type ApiTransferDetail } from '~/types/inventario'
import FiltroPeriodo from '~/components/FiltroPeriodo.vue'


useHead({ title: 'Transferencias · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')
const { transfers,total, page, pageSize, pending, error, storeId, status, refresh, search, from, to } = useTransferHistory()
const { data: stores } = useStores()
const apiFetch = useApiFetch()

const viewingTransfer = ref<ApiTransfer | null>(null)
const transferDetail = ref<ApiTransferDetail | null>(null)
const loadingDetail = ref(false)
const showDetailModal = ref(false)

onMounted(() => refresh())

const storeFilterItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])
const storeFilter = computed({
  get: () => storeId.value ?? 0,
  set: (v: number) => {
    storeId.value = v || undefined
    refresh()
  }
})

const statusItems = [
  { label: 'Todas', value: undefined },
  { label: 'En tránsito', value: 'en_transito' },
  { label: 'Recibida', value: 'recibida' },
  { label: 'Cancelada', value: 'cancelada' }
]

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
const dateOnlyFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })

function fmtDate(s: string | null) {
  return s ? dateFmt.format(new Date(s)) : '—'
}
function fmtDateOnly(s: string | null) {
  return s ? dateOnlyFmt.format(new Date(s)) : '—'
}

const canReceive = (t: ApiTransfer) =>
  t.status === 'en_transito' && (isAdmin.value || me.value?.storeId === t.toStoreId)

const receivingId = ref<number | null>(null)

async function receive(t: ApiTransfer) {
  receivingId.value = t.id
  try {
    await apiFetch(`/api/transfers/${t.id}/receive`, { method: 'POST' })
    await refreshNuxtData('products')
    toast.add({ title: 'Transferencia recibida', description: 'Inventario actualizado en destino.', color: 'success', icon: 'i-lucide-circle-check' })
    await refresh()
  } catch (e) {
    toast.add({ title: 'No se pudo recibir', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    receivingId.value = null
  }
}

const canCancel = (t: ApiTransfer) =>
  t.status === 'en_transito' && (isAdmin.value || me.value?.storeId === t.fromStoreId)

const cancelingId = ref<number | null>(null)
const cancelReason = ref('')
const confirmingCancelId = ref<number | null>(null)

function openCancel(t: ApiTransfer) {
  confirmingCancelId.value = t.id
  cancelReason.value = ''
}

async function confirmCancel(t: ApiTransfer) {
  cancelingId.value = t.id
  try {
    await apiFetch(`/api/transfers/${t.id}/cancel`, {
      method: 'POST',
      body: { reason: cancelReason.value.trim() || undefined }
    })
    await refreshNuxtData('products')
    toast.add({ title: 'Transferencia cancelada', description: 'Se repuso el inventario en origen.', color: 'success', icon: 'i-lucide-circle-check' })
    confirmingCancelId.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: 'No se pudo cancelar', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    cancelingId.value = null
  }
}

async function openDetail(t: ApiTransfer) {
  viewingTransfer.value = t
  transferDetail.value = null
  showDetailModal.value = true
  loadingDetail.value = true
  try {
    transferDetail.value = await apiFetch<ApiTransferDetail>(`/api/transfers/${t.id}`)
  } catch (e) {
    toast.add({ title: 'No se pudo cargar el detalle', description: apiErrorMessage(e), color: 'error' })
    showDetailModal.value = false
  } finally {
    loadingDetail.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Transferencias</h1>
        <p class="text-sm text-muted">{{ transfers.length }} transferencia(s)</p>
      </div>
      <UButton to="/transferencias/nueva" icon="i-lucide-plus" color="primary">
        Nueva transferencia
      </UButton>
    </header>

     <FiltroPeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        search-placeholder="Buscar por nota, sucursal o producto…"
        />


    <div class="flex flex-wrap gap-3">
      <USelect v-if="isAdmin" v-model="storeFilter" :items="storeFilterItems" class="w-60" />
      <USelect v-model="status" :items="statusItems" class="w-44" @update:model-value="refresh" />
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-triangle-alert" title="No se pudo cargar" :description="error" />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Fecha Registro</th>
              <th class="px-4 py-3 font-medium">Fecha de envio</th>
              <th class="px-4 py-3 font-medium">Origen</th>
              <th class="px-4 py-3 font-medium">Destino</th>
              <th class="px-4 py-3 font-medium text-right">Prod.</th>
              <th class="px-4 py-3 font-medium text-right">Valor</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium">Registró</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending"><td colspan="8" class="px-4 py-8 text-center text-muted">Cargando…</td></tr>
            <tr v-else-if="!transfers.length"><td colspan="8" class="px-4 py-8 text-center text-muted">Sin transferencias.</td></tr>
            <tr v-else v-for="t in transfers" :key="t.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(t.createdAt) }}</td>
            <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDateOnly(t.issuedAt) }}</td>

              <td class="px-4 py-3 text-muted">{{ t.fromStoreCode }}</td>
              <td class="px-4 py-3 text-muted">{{ t.toStoreCode }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ t.itemCount }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ currency.format(t.totalValue) }}</td>
              <td class="px-4 py-3 text-center">
                <UBadge
                  :label="TRANSFER_STATUS_LABELS[t.status]"
                  :color="t.status === 'recibida' ? 'success' : t.status === 'en_transito' ? 'warning' : 'neutral'"
                  variant="subtle"
                />
              </td>
              <td class="px-4 py-3 text-muted">{{ t.createdByName ?? '—' }}</td>
                    <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1">
                    <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-eye"
                    @click="openDetail(t)"
                    />
                    <UButton
                    v-if="canReceive(t)"
                    size="xs"
                    color="success"
                    variant="soft"
                    icon="i-lucide-package-check"
                    :loading="receivingId === t.id"
                    @click="receive(t)"
                    >
                    Recibir
                    </UButton>
                    <UButton
                    v-if="canCancel(t) && confirmingCancelId !== t.id"
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-x-circle"
                    @click="openCancel(t)"
                    />
                </div>
                </td>
                <tr v-if="confirmingCancelId === t.id" class="bg-elevated/40">
                    <td colspan="8" class="px-4 py-3">
                        <div class="flex flex-wrap items-end gap-3">
                        <UFormField label="Motivo (opcional)" class="flex-1 min-w-60">
                            <UInput v-model="cancelReason" placeholder="Error de captura, cambio de plan…" class="w-full" />
                        </UFormField>
                        <UButton color="error" icon="i-lucide-x-circle" :loading="cancelingId === t.id" @click="confirmCancel(t)">
                            Confirmar cancelación
                        </UButton>
                        <UButton color="neutral" variant="ghost" @click="confirmingCancelId = null">Cancelar</UButton>
                        </div>
                    </td>
                    </tr>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
        <div class="flex flex-col items-center gap-2">
      <p class="text-xs text-muted">Mostrando {{ transfers.length }} de {{ total }} entrada(s)</p>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>
    <UModal v-model:open="showDetailModal">
  <template #content>
    <UCard :ui="{ body: 'max-h-[70vh] overflow-y-auto' }">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-arrow-left-right" class="size-5 text-primary" />
          <h2 class="font-semibold">
            {{ transferDetail?.fromStoreCode }} → {{ transferDetail?.toStoreCode }}
          </h2>
          <UBadge
            v-if="transferDetail"
            :label="TRANSFER_STATUS_LABELS[transferDetail.status]"
            :color="transferDetail.status === 'recibida' ? 'success' : transferDetail.status === 'en_transito' ? 'warning' : 'neutral'"
            variant="subtle"
            class="ml-auto"
          />
        </div>
      </template>

      <p v-if="loadingDetail" class="text-sm text-muted py-8 text-center">Cargando…</p>

      <div v-else-if="transferDetail" class="space-y-4">
        <div class="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <p class="text-muted">Enviada</p>
            <p class="font-medium">{{ fmtDate(transferDetail.createdAt) }}</p>
          </div>
        <div>
            <p class="text-muted">Registró</p>
            <p class="font-medium">{{ transferDetail.createdByName ?? '—' }}</p>
          </div>
            <div v-if="transferDetail.status === 'recibida'">
                <p class="text-muted">Recibida</p>
                <p class="font-medium">{{ fmtDate(transferDetail.receivedAt) }}</p>
            </div>
            <div v-if="transferDetail.status === 'recibida'">
                <p class="text-muted">Recibió</p>
                <p class="font-medium">{{ transferDetail.receivedByName ?? '—' }}</p>
            </div>
              <div v-if="transferDetail.status === 'cancelada'">
                <p class="text-muted">Cancelada</p>
                <p class="font-medium">{{ fmtDate(transferDetail.canceledAt) }}</p>
            </div>
            <div v-if="transferDetail.status === 'cancelada'">
                <p class="text-muted">Canceló</p>
                <p class="font-medium">{{ transferDetail.canceledByName ?? '—' }}</p>
            </div>

          <div>
            <p class="text-muted">Valor total</p>
            <p class="font-medium">{{ currency.format(transferDetail.totalValue) }}</p>
          </div>
        </div>

        <p v-if="transferDetail.note" class="text-sm text-muted italic">"{{ transferDetail.note }}"</p>
        <UAlert
          v-if="transferDetail.status === 'cancelada'"
          color="error"
          variant="soft"
          icon="i-lucide-x-circle"
          title="Transferencia cancelada"
          :description="transferDetail.cancelReason ?? undefined"
        />

        <USeparator />

        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="py-2 font-medium">Producto</th>
              <th class="py-2 font-medium text-right">Cant.</th>
              <th class="py-2 font-medium text-right">Costo unit.</th>
              <th class="py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="it in transferDetail.items" :key="it.id">
              <td class="py-2">
                <p class="font-medium">{{ it.productName ?? '—' }}</p>
                <p class="text-xs text-muted font-mono">{{ it.productSku ?? '—' }}</p>
              </td>
              <td class="py-2 text-right tabular-nums">{{ it.quantity }} {{ it.unit ? UNIT_LABELS[it.unit] : '' }}</td>
              <td class="py-2 text-right tabular-nums">{{ currency.format(Number(it.unitValue)) }}</td>
              <td class="py-2 text-right tabular-nums">
                {{ currency.format(Number(it.unitValue) * Number(it.quantity)) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex justify-end pt-4">
        <UButton variant="ghost" color="neutral" @click="showDetailModal = false">Cerrar</UButton>
      </div>
    </UCard>
  </template>
</UModal>
  </UContainer>
</template>