<script setup lang="ts">
// ───────────────────────────────────────────────
//  PANEL DE TICKETS DE CORRECCIÓN
// ───────────────────────────────────────────────
// Una sola tabla que sirve a las tres pantallas (/tickets/ventas,
// /tickets/entradas y /tickets/gastos) parametrizada por `target`. El flujo es
// idéntico — el empleado solicita, el admin aprueba o rechaza — y lo único que
// cambia es qué documento se describe y qué pasa al aprobar; eso vive en
// TARGET_META.
import type { ApiTicket, TicketTarget } from '~/types/inventario'

const props = defineProps<{ target: TicketTarget }>()

const toast = useToast()
const { me, seesAllStores } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { tickets, total, page, pageSize, pending, error, status, refresh } = useTicketsHistory(
  props.target
)
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
const qtyFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return dateFmt.format(d)
}

const statusMeta = {
  abierto: { label: 'Abierto', color: 'warning' as const },
  aprobado: { label: 'Aprobado', color: 'success' as const },
  rechazado: { label: 'Rechazado', color: 'error' as const }
}

/** Todo lo que difiere entre las dos pantallas, en un solo lugar. */
const TARGET_META = {
  factura: {
    title: 'Correcciones de ventas',
    docLabel: 'Venta',
    docColumn: 'Venta',
    emptyHint: 'Las solicitudes se abren desde el historial de ventas.',
    backTo: '/ventas',
    backLabel: 'Historial de ventas',
    backIcon: 'i-lucide-scroll-text'
  },
  movimiento: {
    title: 'Correcciones de entradas',
    docLabel: 'Entrada',
    docColumn: 'Entrada',
    emptyHint: 'Las solicitudes se abren desde el historial de entradas.',
    backTo: '/movimientos',
    backLabel: 'Historial de entradas',
    backIcon: 'i-lucide-package-plus'
  },
  gasto: {
    title: 'Correcciones de gastos',
    docLabel: 'Gasto',
    docColumn: 'Gasto',
    emptyHint: 'Las solicitudes se abren desde el listado de gastos.',
    backTo: '/gastos',
    backLabel: 'Gastos operativos',
    backIcon: 'i-lucide-credit-card'
  }
} as const

const meta = computed(() => TARGET_META[props.target])
const isSales = computed(() => props.target === 'factura')
const isExpense = computed(() => props.target === 'gasto')
/** Palabra del documento en minúsculas, para armar frases. */
const docWord = computed(() =>
  isSales.value ? 'la venta' : isExpense.value ? 'el gasto' : 'la entrada'
)

/** Folio (o identificador) del documento al que apunta el ticket. */
function docFolio(t: ApiTicket) {
  if (isSales.value) return t.invoiceFolio ?? '—'
  // El gasto no tiene folio propio: lo identifica la factura del proveedor.
  if (isExpense.value) return t.expenseInvoiceNumber ?? '—'
  return t.movementFolio ?? '—'
}

/** Segunda línea de la celda: importe (venta/gasto) o producto (entrada). */
function docDetail(t: ApiTicket) {
  if (isSales.value) {
    return t.invoiceTotal ? currency.format(Number(t.invoiceTotal)) : null
  }
  if (isExpense.value) {
    const monto = t.expenseTotal ? currency.format(Number(t.expenseTotal)) : null
    if (!t.expenseSupplier) return monto
    return monto ? `${t.expenseSupplier} · ${monto}` : t.expenseSupplier
  }
  if (!t.movementProductName) return null
  const qty = t.movementQuantity
    ? `${qtyFmt.format(Number(t.movementQuantity))} ${t.movementUnit ?? ''}`.trim()
    : ''
  return qty ? `${t.movementProductName} · ${qty}` : t.movementProductName
}

/** Qué va a pasar si el admin aprueba. */
function approvalWarning(t: ApiTicket) {
  if (isSales.value) {
    return `Aprobar anula la venta ${docFolio(t)}: repone el inventario y deja registro en el kardex. No se puede deshacer.`
  }
  if (isExpense.value) {
    return `Aprobar anula el gasto ${docFolio(t)}: BORRA todos sus pagos y revierte el dinero en la cuenta de la que salió. El gasto queda marcado como anulado y ya no se podrá editar ni pagar. No se puede deshacer.`
  }
  return `Aprobar anula la entrada ${docFolio(t)}: descuenta esa mercancía del inventario y borra sus abonos. Solo funciona si ese stock no se ha vendido ni transferido. No se puede deshacer.`
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
  const wasApproval = actingAction.value === 'aprobar'
  submitting.value = true
  try {
    const res = await apiFetch<{ deletedPayments?: number }>(
      `/api/tickets/${t.id}/resolve`,
      {
        method: 'POST',
        body: { action: actingAction.value, note: note.value.trim() || undefined }
      }
    )
    // El endpoint devuelve el ticket, no el documento anulado, así que
    // `deletedPayments` sólo viene en los targets que lo reportan.
    const borrados = res?.deletedPayments ?? 0
    let description = 'El ticket quedó rechazado.'
    if (wasApproval) {
      if (isSales.value) {
        description = `Se anuló la venta ${docFolio(t)} y se repuso el inventario.`
      } else if (isExpense.value) {
        description =
          borrados > 0
            ? `Se anuló el gasto ${docFolio(t)} y se borraron ${borrados} pago(s).`
            : `Se anuló el gasto ${docFolio(t)}.`
      } else {
        description = `Se anuló la entrada ${docFolio(t)} y se descontó del inventario.`
      }
    }
    toast.add({
      title: wasApproval ? 'Ticket aprobado' : 'Ticket rechazado',
      description,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    cancelAction()
    await refresh()
    // Los gastos no mueven inventario: recargar el catálogo ahí no aporta nada.
    if (wasApproval && !isExpense.value) await refreshNuxtData('products')
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

// Documento, Suc., Motivo, Solicitó, Estado, Resolución, Fecha (+ Acciones admin).
const colCount = computed(() => (isAdmin.value ? 8 : 7))
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">{{ meta.title }}</h1>
        <p class="text-sm text-muted">
          {{ total }} ticket(s)
          <template v-if="isAdmin"> · aprueba para anular {{ docWord }}</template>
          <template v-else-if="seesAllStores"> · solicitudes de todas las sucursales</template>
          <template v-else> · solicitudes de tu sucursal</template>
        </p>
      </div>
      <UButton :to="meta.backTo" :icon="meta.backIcon" color="neutral" variant="soft">
        {{ meta.backLabel }}
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
              <th class="px-4 py-3 font-medium">{{ meta.docColumn }}</th>
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
              <td :colspan="colCount" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!tickets.length">
              <td :colspan="colCount" class="px-4 py-8 text-center text-muted">
                Sin tickets para el filtro actual.
                <span class="block text-xs mt-1">{{ meta.emptyHint }}</span>
              </td>
            </tr>
            <template v-for="t in tickets" v-else :key="t.id">
              <tr class="hover:bg-elevated/50">
                <td class="px-4 py-3">
                  <span class="font-mono text-xs">{{ docFolio(t) }}</span>
                  <span v-if="docDetail(t)" class="block text-xs text-muted">
                    {{ docDetail(t) }}
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
                <td :colspan="colCount" class="px-4 py-3">
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
                    {{ approvalWarning(t) }}
                  </p>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </UCard>

    <div class="flex flex-col items-center gap-2">
      <p class="text-xs text-muted">Mostrando {{ tickets.length }} de {{ total }} ticket(s)</p>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>
  </UContainer>
</template>
