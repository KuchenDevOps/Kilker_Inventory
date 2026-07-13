<script setup lang="ts">
useHead({ title: 'Gastos · Inventario Kilker' })

const { expenses, pending, error, storeId, from, to, refresh } = useExpenses()
const { data: stores } = useStores()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')
const toast = useToast()
const apiFetch = useApiFetch()

const storeItems = computed(() =>
  stores.value.filter((s) => s.isActive).map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)

// Filtro de sucursal: 0 = todas (solo visible para admin; empleado ya está
// forzado a su tienda desde el backend).
const storeFilterItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...storeItems.value
])
const storeFilter = computed({
  get: () => storeId.value ?? 0,
  set: (v: number) => {
    storeId.value = v || undefined
  }
})

// search del FiltroPeriodo no aplica aquí (ya tienes tu propio buscador de texto),
// así que lo dejamos sin conectar y usamos un ref suelto que ignoramos.
const periodSearch = ref('')

watch([storeFilter, from, to], () => {
  refresh()
})

onMounted(() => {
  refresh()
})

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
function fmtDate(s: string) {
  return dateFmt.format(new Date(s))
}

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return expenses.value
  return expenses.value.filter(
    (e) =>
      e.supplier.toLowerCase().includes(q) ||
      e.supplierInvoiceNumber.toLowerCase().includes(q) ||
      e.reason.toLowerCase().includes(q)
  )
})

const IVA_RATE = 0.16

// Renombra tu computed actual: era el subtotal, no el total real
const subtotalAmount = computed(() =>
  filtered.value.reduce((sum, e) => sum + Number(e.amount), 0)
)

const ivaAmount = computed(() => subtotalAmount.value * IVA_RATE)

const totalWithIva = computed(() => subtotalAmount.value + ivaAmount.value)

const totalAmount = computed(() =>
  filtered.value.reduce((sum, e) => sum + Number(e.amount), 0)
)

// Alta de gasto (modal)
const showModal = ref(false)
const submitting = ref(false)
const form = reactive({
  storeId: undefined as number | undefined,
  supplier: '',
  supplierInvoiceNumber: '',
  reason: '',
  amount: undefined as number | undefined,
  retentionIVA: 0,
  retentionISR: 0,
  paidAt: '',
  note: ''
})

const showRetentions = ref(false)



const editingId = ref<number | null>(null) // null = alta nueva, number = editando ese id

function openCreate() {
  editingId.value = null
  showRetentions.value = false
  Object.assign(form, {
    storeId: undefined,
    supplier: '',
    supplierInvoiceNumber: '',
    reason: '',
    amount: undefined,
    retentionIVA: 0,
    retentionISR: 0,
    paidAt: '',
    note: ''
  })
  showModal.value = true
}



function openEdit(e: (typeof expenses.value)[number]) {
  editingId.value = e.id
  // Requiere que el backend guarde retentionIva/retentionIsr en el gasto;
  // sin eso no se puede reconstruir el subtotal de forma confiable.
  const retIVA = Number(e.retentionIva ?? 0)
  const retISR = Number(e.retentionIsr ?? 0)
  Object.assign(form, {
    storeId: e.storeId,
    supplier: e.supplier,
    supplierInvoiceNumber: e.supplierInvoiceNumber,
    reason: e.reason,
    // e.amount = subtotal + iva - retIVA - retISR  →  despejamos subtotal
    amount: Number(((Number(e.amount) + retIVA + retISR) / (1 + IVA_RATE)).toFixed(2)),
    retentionIVA: retIVA,
    retentionISR: retISR,
    paidAt: e.paidAt,
    note: e.note ?? ''
  })
  showRetentions.value = retIVA > 0 || retISR > 0
  showModal.value = true
}

const canSubmit = computed(
  () =>
    (isAdmin.value ? form.storeId != null : true) &&
    form.supplier.trim().length > 0 &&
    form.supplierInvoiceNumber.trim().length > 0 &&
    form.reason.trim().length > 0 &&
    form.paidAt.length > 0 &&
    (form.amount ?? -1) >= 0
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const body = {
      storeId: isAdmin.value ? form.storeId : undefined,
      supplier: form.supplier.trim(),
      supplierInvoiceNumber: form.supplierInvoiceNumber.trim(),
      reason: form.reason.trim(),
      amount: Number(formTotalConIva.value.toFixed(2)), // subtotal + IVA - retenciones
      retentionIva: form.retentionIVA || 0,
      retentionIsr: form.retentionISR || 0,
      paidAt: form.paidAt,
      note: form.note.trim() || undefined
    }

    if (editingId.value != null) {
      await apiFetch(`/api/expenses/${editingId.value}`, { method: 'PATCH', body })
      toast.add({ title: 'Gasto actualizado', color: 'success', icon: 'i-lucide-circle-check' })
    } else {
      await apiFetch('/api/expenses', { method: 'POST', body })
      toast.add({ title: 'Gasto registrado', color: 'success', icon: 'i-lucide-circle-check' })
    }

    showModal.value = false
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo guardar el gasto',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}



const formIva = computed(() => (form.amount ?? 0) * IVA_RATE)
const formTotalConIva = computed(
  () => (form.amount ?? 0) + formIva.value - (form.retentionIVA ?? 0) - (form.retentionISR ?? 0)
)
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Gastos</h1>
        
      </div>
      <UButton icon="i-lucide-plus" color="primary" @click="openCreate">
        Nuevo gasto
      </UButton>
    </header>

        <div class="space-y-3">
      <FiltroCortePeriodo
        v-model:search="periodSearch"
        v-model:from="from"
        v-model:to="to"
      />
      <USelect v-if="isAdmin" v-model="storeFilter" :items="storeFilterItems" class="w-60" />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los gastos"
      :description="error"
    />

    <UInput
      v-model="search"
      icon="i-lucide-search"
      placeholder="Buscar por proveedor, factura o motivo…"
      class="w-full sm:max-w-sm"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
                            <th class="px-4 py-3 font-medium">Fecha de pago</th>

              <th class="px-4 py-3 font-medium">Proveedor</th>
              <th class="px-4 py-3 font-medium">Factura</th>
              <th class="px-4 py-3 font-medium">Motivo</th>
              <th class="px-4 py-3 font-medium text-right">Monto</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
                            <th class="px-4 py-3 font-medium">Fecha Registro</th>

              <th class="px-4 py-3 font-medium">Nota</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="9" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!filtered.length">
              <td colspan="9" class="px-4 py-8 text-center text-muted">Sin resultados.</td>
            </tr>
            <tr v-else v-for="e in filtered" :key="e.id" class="hover:bg-elevated/50">
                            <td class="px-4 py-3 text-muted whitespace-nowrap">{{ e.paidAt }}</td>

              <td class="px-4 py-3 font-medium">{{ e.supplier }}</td>
              <td class="px-4 py-3 font-mono text-xs">{{ e.supplierInvoiceNumber }}</td>
              <td class="px-4 py-3 text-muted">{{ e.reason }}</td>
              <td class="px-4 py-3 text-right tabular-nums">{{ currency.format(Number(e.amount)) }}</td>
              <td class="px-4 py-3 text-muted">{{ e.storeCode ?? '—' }}</td>
                            <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(e.createdAt) }}</td>

              <td class="px-4 py-3 text-muted truncate max-w-48">{{ e.note ?? '—' }}</td>
              <td class="px-4 py-3 text-right">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  @click="openEdit(e)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <UModal v-model:open="showModal">
      <template #content>
            <UCard class="max-h-[90vh] flex flex-col">
          <template #header>
            <h2 class="font-semibold">{{ editingId != null ? 'Editar gasto' : 'Nuevo gasto' }}</h2>
          </template>
          <div class="flex-1 overflow-y-auto p-1">

          <form class="space-y-4" @submit.prevent="onSubmit">
            <UFormField v-if="isAdmin" label="Sucursal" required>
              <USelect v-model="form.storeId" :items="storeItems" placeholder="Selecciona una sucursal" class="w-full" />
                </UFormField>

                <UFormField label="Fecha de pago" required>
                  <UInput v-model="form.paidAt" type="date" class="w-full" />
                </UFormField>
            <UFormField label="Proveedor" required>
              <UInput v-model="form.supplier" placeholder="Nombre del proveedor" class="w-full" />
            </UFormField>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Número de factura" required>
                <UInput v-model="form.supplierInvoiceNumber" placeholder="A-12345" class="w-full" />
              </UFormField>
              <UFormField label="Monto (MXN)" required>
                <UInputNumber
                  v-model="form.amount"

                  :min="0"
                  :step="0.01"
                  :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
                  placeholder="0"
                  class="w-full"
                />
              </UFormField>
            </div>
  
       
     <div
  v-if="form.amount"
  class="rounded-lg border border-default bg-elevated/40 px-4 py-3 space-y-3 text-sm"
>
  <div class="flex items-center justify-between gap-2">
    <div>
      <p class="text-muted text-xs">IVA (16%)</p>
      <p class="font-medium tabular-nums text-warning">{{ currency.format(formIva) }}</p>
    </div>
    <UButton
      size="xs"
      variant="ghost"
      color="neutral"
      :icon="showRetentions ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
      @click="showRetentions = !showRetentions"
    >
      Retenciones
    </UButton>
  </div>

        <div v-if="showRetentions" class="grid gap-4 sm:grid-cols-2 pt-2 border-t border-default">
          <UFormField label="Retención IVA">
            <UInputNumber
              v-model="form.retentionIVA"
              :min="0"
              :step="0.01"
              :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
              placeholder="0"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Retención ISR">
            <UInputNumber
              v-model="form.retentionISR"
              :min="0"
              :step="0.01"
              :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
              placeholder="0"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="pt-2 border-t border-default">
          <p class="text-muted text-xs">Total (IVA − retenciones)</p>
          <p class="font-medium tabular-nums text-success">{{ currency.format(formTotalConIva) }}</p>
        </div>
      </div>
            <UFormField label="Motivo" required>
              <UInput v-model="form.reason" placeholder="Renta, luz, mantenimiento…" class="w-full" />
            </UFormField>
            <UFormField label="Nota">
              <UTextarea v-model="form.note" placeholder="Observaciones (opcional)" class="w-full" />
            </UFormField>
            <div class="flex justify-end gap-2 pt-2">
              <UButton type="button" variant="ghost" color="neutral" @click="showModal = false">
                Cancelar
              </UButton>
              <UButton type="submit" color="primary" :loading="submitting" :disabled="!canSubmit">
                Guardar
              </UButton>
            </div>
          </form>
        </div>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>