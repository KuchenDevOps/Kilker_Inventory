<script setup lang="ts">
import type { ApiSale } from '~/types/inventario'

useHead({ title: 'Historial de ventas · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { sales, pending, error, status, storeId, from, to, search, refresh } = useSales()
const { data: stores } = useStores()
const apiFetch = useApiFetch()

// Estado compartido: refrescamos al entrar para no mostrar datos viejos.
onMounted(() => {
  refresh()
})

const statusItems = [
  { label: 'Todas', value: 'todas' },
  { label: 'Emitidas', value: 'emitida' },
  { label: 'Anuladas', value: 'anulada' }
]
const storeItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
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
const voidingId = ref<number | null>(null) // fila con el panel de confirmación abierto
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
      <UButton to="/ventas/nueva" icon="i-lucide-plus" color="primary"> Nueva venta </UButton>
    </header>

    <div class="space-y-3">
      <FiltroPeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        search-placeholder="Buscar folio, sucursal, empleado, método de pago…"
      />
      <div class="flex flex-wrap gap-3">
        <USelect v-model="status" :items="statusItems" class="w-44" />
        <USelect v-if="isAdmin" v-model="storeFilter" :items="storeItems" class="w-60" />
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
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium text-right">Prod.</th>
              <th class="px-4 py-3 font-medium text-right">Total</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium">Creó</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td :colspan="8" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!sales.length">
              <td :colspan="8" class="px-4 py-8 text-center text-muted">
                Sin ventas para el filtro actual.
              </td>
            </tr>
            <template v-for="s in sales" v-else :key="s.id">
              <tr class="hover:bg-elevated/50">
                <td class="px-4 py-3 font-mono text-xs">{{ s.folio }}</td>
                <td class="px-4 py-3 text-muted">{{ s.storeCode ?? '—' }}</td>
                <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(s.issuedAt) }}</td>
                <td class="px-4 py-3 text-right tabular-nums">{{ s.itemCount }}</td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ currency.format(Number(s.totalAmount)) }}
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
                </td>
              </tr>
              <!-- Panel: empleado solicita anulación (abre ticket) -->
              <tr v-if="!isAdmin && requestingId === s.id" class="bg-elevated/40">
                <td :colspan="8" class="px-4 py-3">
                  <div class="flex flex-wrap items-end gap-3">
                    <UFormField label="Motivo de la solicitud" class="flex-1 min-w-60">
                      <UInput
                        v-model="requestReason"
                        placeholder="Ej. cobré de más, el cliente devolvió…"
                        class="w-full"
                      />
                    </UFormField>
                    <div class="flex gap-2">
                      <UButton
                        color="warning"
                        icon="i-lucide-flag"
                        :loading="submittingRequest"
                        @click="confirmRequest(s)"
                      >
                        Enviar solicitud
                      </UButton>
                      <UButton color="neutral" variant="ghost" @click="cancelRequest">
                        Cancelar
                      </UButton>
                    </div>
                  </div>
                  <p class="mt-2 text-xs text-muted">
                    No anula la venta directamente: abre un ticket para que un administrador
                    lo apruebe.
                  </p>
                </td>
              </tr>
              <!-- Panel de confirmación de anulación (admin) -->
              <tr v-if="isAdmin && voidingId === s.id" class="bg-elevated/40">
                <td :colspan="8" class="px-4 py-3">
                  <div class="flex flex-wrap items-end gap-3">
                    <UFormField label="Motivo de la anulación" class="flex-1 min-w-60">
                      <UInput
                        v-model="voidReason"
                        placeholder="Ej. error de captura, devolución…"
                        class="w-full"
                      />
                    </UFormField>
                    <div class="flex gap-2">
                      <UButton
                        color="error"
                        icon="i-lucide-ban"
                        :loading="submittingVoid"
                        @click="confirmVoid(s)"
                      >
                        Confirmar anulación
                      </UButton>
                      <UButton color="neutral" variant="ghost" @click="cancelVoid">
                        Cancelar
                      </UButton>
                    </div>
                  </div>
                  <p class="mt-2 text-xs text-muted">
                    Repone el inventario vendido y marca la factura como anulada (queda
                    registro en el kardex). No se puede deshacer.
                  </p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </UCard>
  </UContainer>
</template>
