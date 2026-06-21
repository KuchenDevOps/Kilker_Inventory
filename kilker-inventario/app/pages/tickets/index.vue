<script setup lang="ts">
import type { ApiTicket } from '~/types/inventario'

useHead({ title: 'Tickets de corrección · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { tickets, pending, error, status, refresh } = useTickets()
const apiFetch = useApiFetch()

onMounted(() => {
  refresh()
})

const statusItems = [
  { label: 'Todos', value: 'todos' },
  { label: 'Abiertos', value: 'abierto' },
  { label: 'Aprobados', value: 'aprobado' },
  { label: 'Rechazados', value: 'rechazado' }
]

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
function fmtDate(s: string | null) {
  return s ? dateFmt.format(new Date(s)) : '—'
}

const statusMeta = {
  abierto: { label: 'Abierto', color: 'warning' as const },
  aprobado: { label: 'Aprobado', color: 'success' as const },
  rechazado: { label: 'Rechazado', color: 'error' as const }
}

// Resolución (admin): panel inline con nota para aprobar o rechazar.
const actingId = ref<number | null>(null)
const actingAction = ref<'aprobar' | 'rechazar' | null>(null)
const note = ref('')
const submitting = ref(false)

function openAction(t: ApiTicket, action: 'aprobar' | 'rechazar') {
  actingId.value = t.id
  actingAction.value = action
  note.value = ''
}
function cancelAction() {
  actingId.value = null
  actingAction.value = null
  note.value = ''
}

async function confirmAction(t: ApiTicket) {
  if (!actingAction.value) return
  submitting.value = true
  try {
    await apiFetch(`/api/tickets/${t.id}/resolve`, {
      method: 'POST',
      body: { action: actingAction.value, note: note.value.trim() || undefined }
    })
    toast.add({
      title: actingAction.value === 'aprobar' ? 'Ticket aprobado' : 'Ticket rechazado',
      description:
        actingAction.value === 'aprobar'
          ? `Se anuló la venta ${t.invoiceFolio ?? ''} y se repuso el inventario.`
          : 'El ticket quedó rechazado.',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    cancelAction()
    await refresh()
    if (actingAction.value === 'aprobar') await refreshNuxtData('products')
  } catch (e) {
    toast.add({
      title: 'No se pudo resolver el ticket',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Tickets de corrección</h1>
        <p class="text-sm text-muted">
          {{ tickets.length }} ticket(s)
          <template v-if="isAdmin"> · aprueba para anular la venta</template>
          <template v-else> · solicitudes de anulación de tu sucursal</template>
        </p>
      </div>
      <UButton to="/ventas" icon="i-lucide-scroll-text" color="neutral" variant="soft">
        Ir al historial de ventas
      </UButton>
    </header>

    <USelect v-model="status" :items="statusItems" class="w-44" />

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los tickets"
      :description="error"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Venta</th>
              <th class="px-4 py-3 font-medium">Suc.</th>
              <th class="px-4 py-3 font-medium">Motivo</th>
              <th class="px-4 py-3 font-medium">Solicitó</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium">Resolución</th>
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th v-if="isAdmin" class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td :colspan="isAdmin ? 8 : 7" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!tickets.length">
              <td :colspan="isAdmin ? 8 : 7" class="px-4 py-8 text-center text-muted">
                Sin tickets para el filtro actual.
              </td>
            </tr>
            <template v-for="t in tickets" v-else :key="t.id">
              <tr class="hover:bg-elevated/50">
                <td class="px-4 py-3">
                  <span class="font-mono text-xs">{{ t.invoiceFolio ?? '—' }}</span>
                  <span v-if="t.invoiceTotal" class="block text-xs text-muted">
                    {{ currency.format(Number(t.invoiceTotal)) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-muted">{{ t.storeCode ?? '—' }}</td>
                <td class="px-4 py-3 max-w-xs">{{ t.reason }}</td>
                <td class="px-4 py-3 text-muted">{{ t.raisedByName ?? '—' }}</td>
                <td class="px-4 py-3 text-center">
                  <UBadge
                    :label="statusMeta[t.status].label"
                    :color="statusMeta[t.status].color"
                    variant="subtle"
                  />
                </td>
                <td class="px-4 py-3 text-muted text-xs">
                  <template v-if="t.status !== 'abierto'">
                    {{ t.resolvedByName ?? '—' }}
                    <span v-if="t.resolutionNote" class="block">«{{ t.resolutionNote }}»</span>
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(t.createdAt) }}</td>
                <td v-if="isAdmin" class="px-4 py-3 text-right">
                  <div v-if="t.status === 'abierto' && actingId !== t.id" class="flex justify-end gap-1">
                    <UButton
                      size="xs"
                      color="success"
                      variant="soft"
                      icon="i-lucide-check"
                      @click="openAction(t, 'aprobar')"
                    >
                      Aprobar
                    </UButton>
                    <UButton
                      size="xs"
                      color="error"
                      variant="ghost"
                      icon="i-lucide-x"
                      @click="openAction(t, 'rechazar')"
                    >
                      Rechazar
                    </UButton>
                  </div>
                  <span v-else-if="t.status !== 'abierto'" class="text-xs text-muted">—</span>
                </td>
              </tr>
              <!-- Panel de confirmación (admin) -->
              <tr v-if="isAdmin && actingId === t.id" class="bg-elevated/40">
                <td :colspan="8" class="px-4 py-3">
                  <div class="flex flex-wrap items-end gap-3">
                    <UFormField
                      :label="actingAction === 'aprobar' ? 'Nota (opcional)' : 'Motivo del rechazo (opcional)'"
                      class="flex-1 min-w-60"
                    >
                      <UInput v-model="note" placeholder="Observaciones…" class="w-full" />
                    </UFormField>
                    <div class="flex gap-2">
                      <UButton
                        :color="actingAction === 'aprobar' ? 'success' : 'error'"
                        :icon="actingAction === 'aprobar' ? 'i-lucide-check' : 'i-lucide-x'"
                        :loading="submitting"
                        @click="confirmAction(t)"
                      >
                        {{ actingAction === 'aprobar' ? 'Confirmar aprobación' : 'Confirmar rechazo' }}
                      </UButton>
                      <UButton color="neutral" variant="ghost" @click="cancelAction">Cancelar</UButton>
                    </div>
                  </div>
                  <p v-if="actingAction === 'aprobar'" class="mt-2 text-xs text-muted">
                    Aprobar anula la venta {{ t.invoiceFolio }}: repone el inventario y deja
                    registro en el kardex. No se puede deshacer.
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
