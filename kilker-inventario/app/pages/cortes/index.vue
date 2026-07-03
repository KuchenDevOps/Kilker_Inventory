<script setup lang="ts">
import { PAYMENT_LABELS, type ApiCorte, type ApiCorteDetail } from '~/types/inventario'

useHead({ title: 'Cortes de caja · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { cortes, pending, error, storeId, refresh, from, to, search } = useCortes()
const { data: stores } = useStores()
const apiFetch = useApiFetch()

onMounted(() => {
  refresh()
})

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
function fmtDate(s: string | null) {
  return s ? dateFmt.format(new Date(s)) : 'inicio'
}

const storeFilterItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])
const storeFilter = computed({
  get: () => storeId.value ?? 0,
  set: (v: number) => {
    storeId.value = v || undefined
  }
})

// Hacer corte (panel inline).
const makingCorte = ref(false)
const corteStoreId = ref<number | undefined>(undefined)
const corteNote = ref('')
const submittingCorte = ref(false)

const storeSelectItems = computed(() =>
  stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)

function openMakeCorte() {
  makingCorte.value = true
  corteStoreId.value = isAdmin.value ? undefined : (me.value?.storeId ?? undefined)
  corteNote.value = ''
}
function cancelMakeCorte() {
  makingCorte.value = false
}

const canSubmitCorte = computed(() => (isAdmin.value ? corteStoreId.value != null : true))

async function submitCorte() {
  submittingCorte.value = true
  try {
    const body: Record<string, unknown> = { note: corteNote.value.trim() || undefined }
    if (isAdmin.value) body.storeId = corteStoreId.value
    const created = await apiFetch<ApiCorte>('/api/cortes', { method: 'POST', body })
    toast.add({
      title: 'Corte realizado',
      description: `${created.salesCount} venta(s) · ${currency.format(Number(created.totalEmitido))}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    makingCorte.value = false
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo hacer el corte',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submittingCorte.value = false
  }
}

// Detalle expandible (estado de cuenta del corte).
const openDetailId = ref<number | null>(null)
const detail = ref<ApiCorteDetail | null>(null)
const loadingDetail = ref(false)

async function toggleDetail(c: ApiCorte) {
  if (openDetailId.value === c.id) {
    openDetailId.value = null
    detail.value = null
    return
  }
  openDetailId.value = c.id
  detail.value = null
  loadingDetail.value = true
  try {
    detail.value = await apiFetch<ApiCorteDetail>(`/api/cortes/${c.id}`)
  } catch (e) {
    toast.add({ title: 'No se pudo cargar el detalle', description: apiErrorMessage(e), color: 'error' })
    openDetailId.value = null
  } finally {
    loadingDetail.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Cortes de caja</h1>
        <p class="text-sm text-muted">
          {{ cortes.length }} corte(s)
          <template v-if="!isAdmin"> · tu sucursal</template>
        </p>
      </div>
      <UButton icon="i-lucide-scissors" color="primary" :disabled="makingCorte" @click="openMakeCorte">
        Hacer corte
      </UButton>
    </header>

     <div class="space-y-3">
      <FiltroCortePeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        search-placeholder="Buscar producto, SKU, factura, sucursal…"
      />
      
      <USelect v-if="isAdmin" v-model="storeFilter" :items="storeFilterItems" class="w-60" />
    </div>

    <!-- Panel: hacer corte -->
    <UCard v-if="makingCorte">
      <template #header>
        <h2 class="font-semibold">Nuevo corte de caja</h2>
      </template>
      <div class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField v-if="isAdmin" label="Sucursal" required>
            <USelect
              v-model="corteStoreId"
              :items="storeSelectItems"
              placeholder="Selecciona una sucursal"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Nota (opcional)">
            <UInput v-model="corteNote" placeholder="Turno, cajero…" class="w-full" />
          </UFormField>
        </div>
        <p class="text-xs text-muted">
          El corte resume las ventas de la sucursal desde el corte anterior hasta ahora,
          separando efectivo y tarjeta.
        </p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="cancelMakeCorte">Cancelar</UButton>
          <UButton
            color="primary"
            icon="i-lucide-scissors"
            :loading="submittingCorte"
            :disabled="!canSubmitCorte"
            @click="submitCorte"
          >
            Hacer corte
          </UButton>
        </div>
      </div>
    </UCard>

   
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los cortes"
      :description="error"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium">Suc.</th>
              <th class="px-4 py-3 font-medium text-right">Ventas</th>
              <th class="px-4 py-3 font-medium text-right">Efectivo</th>
              <th class="px-4 py-3 font-medium text-right">Tarjeta</th>
              <th class="px-4 py-3 font-medium text-right">Transferencia</th>
              <th class="px-4 py-3 font-medium text-right">Total</th>
              <th class="px-4 py-3 font-medium">Hizo</th>
              <th class="px-4 py-3 font-medium text-right">Detalle</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="9" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!cortes.length">
              <td colspan="9" class="px-4 py-8 text-center text-muted">
                Aún no hay cortes. Haz el primero con “Hacer corte”.
              </td>
            </tr>
            <template v-for="c in cortes" v-else :key="c.id">
              <tr class="hover:bg-elevated/50">
                <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(c.createdAt) }}</td>
                <td class="px-4 py-3 text-muted">{{ c.storeCode ?? '—' }}</td>
                <td class="px-4 py-3 text-right tabular-nums">{{ c.salesCount }}</td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ currency.format(Number(c.totalEfectivo)) }}
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ currency.format(Number(c.totalTarjeta)) }}
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ currency.format(Number(c.totalTransferencia)) }}
                </td>
                <td class="px-4 py-3 text-right tabular-nums font-medium">
                  {{ currency.format(Number(c.totalEmitido)) }}
                </td>
                <td class="px-4 py-3 text-muted">{{ c.createdByName ?? '—' }}</td>
                <td class="px-4 py-3 text-right">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :icon="openDetailId === c.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    @click="toggleDetail(c)"
                  />
                </td>
              </tr>
              <!-- Detalle: estado de cuenta del periodo -->
              <tr v-if="openDetailId === c.id" class="bg-elevated/40">
                <td colspan="9" class="px-4 py-3">
                  <p class="text-xs text-muted mb-2">
                    Periodo: {{ fmtDate(c.periodFrom) }} → {{ fmtDate(c.periodTo) }}
                    <span v-if="c.voidedCount">
                      · {{ c.voidedCount }} anulada(s) ({{ currency.format(Number(c.totalVoided)) }})
                    </span>
                    <span v-if="c.note"> · {{ c.note }}</span>
                  </p>
                  <p v-if="loadingDetail" class="text-sm text-muted">Cargando detalle…</p>
                  <table v-else-if="detail" class="w-full text-xs">
                    <thead class="text-muted">
                      <tr class="text-left">
                        <th class="py-1 pr-3 font-medium">Folio</th>
                        <th class="py-1 pr-3 font-medium">Hora</th>
                        <th class="py-1 pr-3 font-medium">Pago</th>
                        <th class="py-1 pr-3 font-medium text-center">Estado</th>
                        <th class="py-1 pr-3 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="!detail.sales.length">
                        <td colspan="5" class="py-2 text-muted">Sin ventas en el periodo.</td>
                      </tr>
                      <tr v-for="s in detail.sales" :key="s.id" class="border-t border-default/60">
                        <td class="py-1 pr-3 font-mono">{{ s.folio }}</td>
                        <td class="py-1 pr-3 text-muted">{{ fmtDate(s.issuedAt) }}</td>
                        <td class="py-1 pr-3">{{ PAYMENT_LABELS[s.paymentMethod] }}</td>
                        <td class="py-1 pr-3 text-center">
                          <UBadge
                            :label="s.status === 'anulada' ? 'Anulada' : 'Emitida'"
                            :color="s.status === 'anulada' ? 'error' : 'success'"
                            variant="subtle"
                            size="xs"
                          />
                        </td>
                        <td class="py-1 pr-3 text-right tabular-nums">
                          {{ currency.format(Number(s.totalAmount)) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </UCard>
  </UContainer>
</template>
