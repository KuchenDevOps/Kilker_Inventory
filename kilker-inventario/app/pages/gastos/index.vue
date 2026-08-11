<script setup lang="ts">
useHead({ title: 'Gastos · Inventario Kilker' })

import type { ApiExpense, ApiExpensePayment, PaymentMethod } from '~/types/inventario'
import { PAYMENT_LABELS, EXPENSE_TYPE_LABELS, type ExpenseType } from '~/types/inventario'
const { expenses, total, page, pageSize, pending, error, storeId, type, from, to, search, paidBy, refresh } = useExpenses()
const { data: stores } = useStores()
const { me, canWrite, seesAllStores } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')
const toast = useToast()
const apiFetch = useApiFetch()

const expenseTypeItems = (Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[]).map((v) => ({
  label: EXPENSE_TYPE_LABELS[v],
  value: v
}))

const storeItems = computed(() =>
  stores.value.filter((s) => s.isActive).map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)

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
const expenseTypeFilterItems = computed(() => [
  { label: 'Todos los tipos', value: undefined },
  ...expenseTypeItems
])

const periodSearch = ref('')

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
function fmtDate(s: string) {
  return dateFmt.format(new Date(s))
}

const IVA_RATE = 0.16

// ───────────────────────────────────────────────
//  ALTA / EDICIÓN DE GASTO (con líneas de concepto)
// ───────────────────────────────────────────────
type ExpenseItemForm = { reason: string; amount: number | undefined }

const showModal = ref(false)
const submitting = ref(false)
const form = reactive({
  storeId: undefined as number | undefined,
  supplier: '',
  supplierInvoiceNumber: '',
  type: 'Operativo' as ExpenseType,
  items: [{ reason: '', amount: undefined }] as ExpenseItemForm[],
  retentionIVA: 0,
  retentionISR: 0,
  paidAt: '',
  note: ''
})

const showRetentions = ref(false)
const editingId = ref<number | null>(null)

function emptyItem(): ExpenseItemForm {
  return { reason: '', amount: undefined }
}

function addItem() {
  form.items.push(emptyItem())
}
function removeItem(i: number) {
  form.items.splice(i, 1)
  if (form.items.length === 0) addItem()
}

function openCreate() {
  editingId.value = null
  showRetentions.value = false
  Object.assign(form, {
    storeId: undefined,
    supplier: '',
    supplierInvoiceNumber: '',
    type: 'Operativo',
    items: [emptyItem()],
    retentionIVA: 0,
    retentionISR: 0,
    paidAt: '',
    note: ''
  })
  showModal.value = true
}

function openEdit(e: ApiExpense) {
  editingId.value = e.id
  const retIVA = Number(e.retentionIva ?? 0)
  const retISR = Number(e.retentionIsr ?? 0)
  Object.assign(form, {
    storeId: e.storeId,
    supplier: e.supplier,
    supplierInvoiceNumber: e.supplierInvoiceNumber,
    type: e.type,
    items: e.items.length
      ? e.items.map((it) => ({ reason: it.reason, amount: Number(it.amount) }))
      : [emptyItem()],
    retentionIVA: retIVA,
    retentionISR: retISR,
    paidAt: e.paidAt,
    note: e.note ?? ''
  })
  showRetentions.value = retIVA > 0 || retISR > 0
  showModal.value = true
}

// ───────────────────────────────────────────────
//  TOTALES: subtotal (a pagar) vs. con IVA, por tipo
// ───────────────────────────────────────────────
const totalsSummary = computed(() => {
  const base = {
    Fijo: { subtotal: 0, total: 0 },
    Operativo: { subtotal: 0, total: 0 }
  }
  for (const e of expenses.value) {
    base[e.type].subtotal += e.subtotal
    base[e.type].total += Number(e.amount)
  }
  const subtotalAll = base.Fijo.subtotal + base.Operativo.subtotal
  const totalAll = base.Fijo.total + base.Operativo.total
  return { ...base, all: { subtotal: subtotalAll, total: totalAll } }
})

const validItems = computed(() =>
  form.items.filter((it) => it.reason.trim().length > 0 && (it.amount ?? 0) > 0)
)

// Lo que se debe pagar es el subtotal. IVA y retenciones son informativos.
const formSubtotal = computed(() => validItems.value.reduce((sum, it) => sum + (it.amount ?? 0), 0))
const formIva = computed(() => formSubtotal.value * IVA_RATE)
const formTotalWithTaxes = computed(
  () => formSubtotal.value + formIva.value - (form.retentionIVA || 0) - (form.retentionISR || 0)
)

const canSubmit = computed(
  () =>
    canWrite.value &&
    (isAdmin.value ? form.storeId != null : true) &&
    form.supplier.trim().length > 0 &&
    form.supplierInvoiceNumber.trim().length > 0 &&
    validItems.value.length > 0 &&
    form.paidAt.length > 0
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const body = {
      storeId: isAdmin.value ? form.storeId : undefined,
      supplier: form.supplier.trim(),
      supplierInvoiceNumber: form.supplierInvoiceNumber.trim(),
      type: form.type,
      items: validItems.value.map((it) => ({ reason: it.reason.trim(), amount: it.amount })),
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

// ───────────────────────────────────────────────
//  MODAL DE PAGOS (muestra desglose de items)
// ───────────────────────────────────────────────
const viewingExpense = ref<ApiExpense | null>(null)
const showPaymentsModal = ref(false)
const payments = ref<ApiExpensePayment[]>([])
const loadingPayments = ref(false)

const paymentMethodItems = (Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((v) => ({
  label: PAYMENT_LABELS[v],
  value: v
}))

const paymentForm = reactive({
  amount: undefined as number | undefined,
  paidAt: '',
  paidBy: '',
  method: 'efectivo' as PaymentMethod,
  note: ''
})
const submittingPayment = ref(false)

async function openPayments(e: ApiExpense) {
  viewingExpense.value = e
  showPaymentsModal.value = true
  Object.assign(paymentForm, {
    amount: undefined,
  paidBy: '', 
    paidAt: new Date().toISOString().slice(0, 10),
    method: 'efectivo',
    note: ''
  })
  await refreshPayments()
}

async function refreshPayments() {
  if (!viewingExpense.value) return
  loadingPayments.value = true
  try {
    payments.value = await apiFetch<ApiExpensePayment[]>(
      `/api/expenses/${viewingExpense.value.id}/payments`
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
    (paymentForm.amount ?? 0) > 0 &&
    paymentForm.paidAt.length > 0 &&
    !!viewingExpense.value &&
    paymentForm.paidBy != '' &&
    (paymentForm.amount ?? 0) <= viewingExpense.value.balance + 0.01
)

async function submitPayment() {
  if (!canSubmitPayment.value || !viewingExpense.value) return
  submittingPayment.value = true
  try {
    await apiFetch(`/api/expenses/${viewingExpense.value.id}/payments`, {
      method: 'POST',
      body: {
        amount: paymentForm.amount,
        paidAt: paymentForm.paidAt,
        paidBy: paymentForm.paidBy,
        method: paymentForm.method,
        note: paymentForm.note.trim() || undefined
      }
    })
    toast.add({ title: 'Pago registrado', color: 'success', icon: 'i-lucide-circle-check' })
    Object.assign(paymentForm, { amount: undefined, note: '' })
    await refreshPayments()
    await refresh()
    const updated = expenses.value.find((x) => x.id === viewingExpense.value?.id)
    if (updated) viewingExpense.value = updated
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

const dayFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })
function fmtDay(s: string) {
  return dayFmt.format(new Date(`${s}T00:00:00`))
}

const viewingTotalWithTaxes = computed(() => {
  if (!viewingExpense.value) return 0
  return (
    viewingExpense.value.subtotal +
    viewingExpense.value.iva -
    Number(viewingExpense.value.retentionIva ?? 0) -
    Number(viewingExpense.value.retentionIsr ?? 0)
  )
})

// Resumen de conceptos para la tabla (evita mostrar N filas por gasto).
function reasonsSummary(e: ApiExpense) {
  if (!e.items?.length) return '—'
  if (e.items.length === 1) return e.items[0].reason
  return `${e.items[0].reason} +${e.items.length - 1} más`
}

onMounted(() => {
  refresh()
})
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Gastos</h1>
        <p class="text-sm text-muted">{{ total }} gasto(s)</p>
      </div>
      <UButton v-if="canWrite" icon="i-lucide-plus" color="primary" @click="openCreate">
        Nuevo gasto
      </UButton>
    </header>

    <div class="space-y-3">
      <FiltroCortePeriodo
        v-model:search="periodSearch"
        v-model:from="from"
        v-model:to="to"
      />
      <div class="flex flex-wrap gap-3">
        <USelect v-if="seesAllStores" v-model="storeFilter" :items="storeFilterItems" class="w-60" />
        <USelect v-model="type" :items="expenseTypeFilterItems" placeholder="Tipo de gasto" class="w-48" />
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los gastos"
      :description="error"
    />

    <div class="flex flex-wrap gap-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Buscar por proveedor, factura o concepto…"
        class="w-full sm:max-w-sm"
      />
      <UInput
        v-model="paidBy"
        icon="i-lucide-building-2"
        placeholder="Pagado por… (empresa)"
        class="w-full sm:max-w-xs"
      >
        <template v-if="paidBy" #trailing>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="link"
            size="xs"
            aria-label="Limpiar filtro de pagador"
            @click="paidBy = ''"
          />
        </template>
      </UInput>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Fecha de Factura</th>
              <th class="px-4 py-3 font-medium">Proveedor</th>
              <th class="px-4 py-3 font-medium">Factura</th>
              <th class="px-4 py-3 font-medium">Tipo</th>
              <th class="px-4 py-3 font-medium text-right">A pagar</th>
              <th class="px-4 py-3 font-medium text-right">Con IVA</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium">Fecha Registro</th>
              <th class="px-4 py-3 font-medium">Nota</th>
              <th class="px-4 py-3 font-medium">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Saldo</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="13" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!expenses.length">
              <td colspan="13" class="px-4 py-8 text-center text-muted">Sin resultados.</td>
            </tr>
            <tr v-else v-for="e in expenses" :key="e.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 text-muted whitespace-nowrap">{{ e.paidAt }}</td>
              <td class="px-4 py-3 font-medium">{{ e.supplier }}</td>
              <td class="px-4 py-3 font-mono text-xs">{{ e.supplierInvoiceNumber }}</td>
              <td class="px-4 py-3">
                <UBadge :label="e.type" :color="e.type === 'Fijo' ? 'info' : 'neutral'" variant="subtle" />
              </td>
              <td class="px-4 py-3 text-right tabular-nums">{{ currency.format(Number(e.amount)) }}</td>
              <td class="px-4 py-3 text-right tabular-nums text-muted">
                {{ currency.format(Number(e.amount) + e.iva - Number(e.retentionIva ?? 0) - Number(e.retentionIsr ?? 0)) }}
              </td>
              <td class="px-4 py-3 text-muted">{{ e.storeCode ?? '—' }}</td>
              <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(e.createdAt) }}</td>
              <td class="px-4 py-3 text-muted truncate max-w-48">{{ e.note ?? '—' }}</td>
             
              <td class="px-4 py-3">
                <UBadge
                  :label="e.paymentStatus === 'pagado' ? 'Pagado' : e.paymentStatus === 'parcial' ? 'Parcial' : 'Pendiente'"
                  :color="e.paymentStatus === 'pagado' ? 'success' : e.paymentStatus === 'parcial' ? 'warning' : 'error'"
                  variant="subtle"
                />
              </td>
              <td class="px-4 py-3 text-right tabular-nums">{{ currency.format(e.balance) }}</td>
              <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-wallet"
                    @click="openPayments(e)"
                  />
                  <UButton
                    v-if="canWrite"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-pencil"
                    @click="openEdit(e)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <div class="flex flex-col items-center gap-2">
      <p class="text-xs text-muted">Mostrando {{ expenses.length }} de {{ total }} gastos</p>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>

    <!-- Alta / edición -->
    <UModal v-model:open="showModal">
      <template #content>
        <UCard :ui="{ body: 'max-h-[75vh] overflow-y-auto' }">
          <template #header>
            <h2 class="font-semibold">{{ editingId != null ? 'Editar gasto' : 'Nuevo gasto' }}</h2>
          </template>

          <form class="space-y-4" @submit.prevent="onSubmit">
            <UFormField v-if="isAdmin" label="Sucursal" required>
              <USelect v-model="form.storeId" :items="storeItems" placeholder="Selecciona una sucursal" class="w-full" />
            </UFormField>

            <UFormField label="Fecha de Factura" required>
              <UInput v-model="form.paidAt" type="date" class="w-full" />
            </UFormField>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Proveedor" required>
                <UInput v-model="form.supplier" placeholder="Nombre del proveedor" class="w-full" />
              </UFormField>
              <UFormField label="Tipo de gasto" required>
                <USelect v-model="form.type" :items="expenseTypeItems" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Número de factura" required>
              <UInput v-model="form.supplierInvoiceNumber" placeholder="A-12345" class="w-full" />
            </UFormField>

            <USeparator />

            <!-- Líneas de concepto -->
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="font-semibold text-sm">Conceptos</h3>
                <UButton
                  type="button"
                  size="xs"
                  variant="soft"
                  icon="i-lucide-plus"
                  @click="addItem"
                >
                  Agregar concepto
                </UButton>
              </div>

              <div
                v-for="(item, i) in form.items"
                :key="i"
                class="grid items-end gap-3 sm:grid-cols-12 rounded-lg border border-default p-3"
              >
                <UFormField label="Concepto" class="sm:col-span-7">
                  <UInput v-model="item.reason" placeholder="Renta, luz, mantenimiento…" class="w-full" />
                </UFormField>
                <UFormField label="Monto (MXN)" class="sm:col-span-4">
                  <UInputNumber
                    v-model="item.amount"
                    :min="0"
                    :step="0.01"
                    :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
                    placeholder="0"
                    class="w-full"
                  />
                </UFormField>
                <div class="sm:col-span-1 flex justify-end">
                  <UButton
                    type="button"
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    @click="removeItem(i)"
                  />
                </div>
              </div>
            </div>

            <USeparator />

            <!-- IVA y retenciones: SOLO informativo, no afecta lo que se debe pagar -->
            <div
              v-if="formSubtotal > 0"
              class="rounded-lg border border-default bg-elevated/40 px-4 py-3 space-y-3 text-sm"
            >
              <div class="flex justify-between font-medium">
                <span>Total a pagar</span>
                <span class="tabular-nums text-success">{{ currency.format(formSubtotal) }}</span>
              </div>

              <div class="flex items-center justify-between gap-2 pt-2 border-t border-default">
                <div>
                  <p class="text-muted text-xs">IVA (16%) · informativo</p>
                  <p class="text-sm tabular-nums text-muted">{{ currency.format(formIva) }}</p>
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
                <UFormField label="Retención IVA (informativo)">
                  <UInputNumber
                    v-model="form.retentionIVA"
                    :min="0"
                    :step="0.01"
                    :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
                    placeholder="0"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Retención ISR (informativo)">
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

              <div class="flex justify-between font-semibold pt-2 border-t border-default">
                <span>Total con IVA y retenciones</span>
                <span class="tabular-nums">{{ currency.format(formTotalWithTaxes) }}</span>
              </div>
            </div>

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
        </UCard>
      </template>
    </UModal>

    <!-- Pagos -->
    <UModal v-model:open="showPaymentsModal">
      <template #content>
        <UCard :ui="{ body: 'max-h-[75vh] overflow-y-auto' }">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-wallet" class="size-5 text-primary" />
              <h2 class="font-semibold">{{ viewingExpense?.supplier }}</h2>
              <UBadge
                v-if="viewingExpense"
                :label="
                  viewingExpense.paymentStatus === 'pagado'
                    ? 'Pagado'
                    : viewingExpense.paymentStatus === 'parcial'
                      ? 'Parcial'
                      : 'Pendiente'
                "
                :color="
                  viewingExpense.paymentStatus === 'pagado'
                    ? 'success'
                    : viewingExpense.paymentStatus === 'parcial'
                      ? 'warning'
                      : 'error'
                "
                variant="subtle"
                class="ml-auto"
              />
            </div>
          </template>

          <div v-if="viewingExpense" class="space-y-5">
            <!-- Desglose de conceptos -->
            <div>
              <h3 class="text-sm font-semibold mb-2">Conceptos</h3>
              <table class="w-full text-sm">
                <thead class="text-muted border-b border-default">
                  <tr class="text-left">
                    <th class="py-2 font-medium">Concepto</th>
                    <th class="py-2 font-medium text-right">Monto</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr v-for="it in viewingExpense.items" :key="it.id">
                    <td class="py-2">{{ it.reason }}</td>
                    <td class="py-2 text-right tabular-nums">{{ currency.format(Number(it.amount)) }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="pt-3 mt-2 border-t border-default space-y-1 text-sm">
                <div class="flex justify-between font-medium">
                  <span>Subtotal (a pagar)</span>
                  <span class="tabular-nums">{{ currency.format(viewingExpense.subtotal) }}</span>
                </div>
                <div class="flex justify-between text-muted">
                  <span>IVA (16%) · informativo</span>
                  <span class="tabular-nums">{{ currency.format(viewingExpense.iva) }}</span>
                </div>
                <div v-if="Number(viewingExpense.retentionIva) > 0" class="flex justify-between text-muted">
                  <span>Retención IVA · informativo</span>
                  <span class="tabular-nums">-{{ currency.format(Number(viewingExpense.retentionIva)) }}</span>
                </div>
                <div v-if="Number(viewingExpense.retentionIsr) > 0" class="flex justify-between text-muted">
                  <span>Retención ISR · informativo</span>
                  <span class="tabular-nums">-{{ currency.format(Number(viewingExpense.retentionIsr)) }}</span>
                </div>
                <div class="flex justify-between font-semibold pt-2 mt-1 border-t border-default">
                  <span>Total con IVA y retenciones</span>
                  <span class="tabular-nums">{{ currency.format(viewingTotalWithTaxes) }}</span>
                </div>
              </div>
            </div>

            <USeparator />

            <!-- Resumen de pago -->
            <div class="grid gap-3 sm:grid-cols-3 text-sm rounded-lg bg-elevated/40 px-4 py-3">
              <div>
                <p class="text-muted text-xs">Total a pagar</p>
                <p class="font-medium tabular-nums">{{ currency.format(viewingExpense.totalToPay) }}</p>
              </div>
              <div>
                <p class="text-muted text-xs">Pagado</p>
                <p class="font-medium tabular-nums text-success">
                  {{ currency.format(viewingExpense.totalPaid) }}
                </p>
              </div>
              <div>
                <p class="text-muted text-xs">Saldo pendiente</p>
                <p class="font-medium tabular-nums text-error">
                  {{ currency.format(viewingExpense.balance) }}
                </p>
              </div>
            </div>

            <!-- Historial de pagos -->
            <div>
              <h3 class="text-sm font-semibold mb-2">Historial de pagos</h3>
              <p v-if="loadingPayments" class="text-sm text-muted py-4 text-center">Cargando…</p>
              <p v-else-if="!payments.length" class="text-sm text-muted py-4 text-center">
                Sin pagos registrados todavía.
              </p>
              <ul v-else class="divide-y divide-default text-sm">
                <li
                  v-for="p in payments"
                  :key="p.id"
                  class="flex items-center justify-between gap-3 py-2"
                >
                  <div>
                    <p class="font-medium">{{ currency.format(Number(p.amount)) }} pagado por {{ p.paidBy }}</p>
                    <p class="text-xs text-muted">
                      {{ fmtDay(p.paidAt) }} · {{ PAYMENT_LABELS[p.method] }} 
                      <span v-if="p.createdByName"> · {{ p.createdByName }}</span>
                    </p>
                    <p v-if="p.note" class="text-xs text-muted italic">"{{ p.note }}"</p>
                  </div>
                </li>
              </ul>
            </div>

            <USeparator v-if="canWrite && viewingExpense.balance > 0" />

            <!-- Registrar nuevo pago (el observador ve el historial, no el alta) -->
            <div v-if="canWrite && viewingExpense.balance > 0" class="space-y-3">
              <h3 class="text-sm font-semibold">Registrar pago</h3>
              <div class="grid gap-3 sm:grid-cols-2">
                <UFormField label="Monto">
                  <UInputNumber
                    v-model="paymentForm.amount"
                    :min="0"
                    :max="viewingExpense.balance"
                    :step="0.01"
                    :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
                    :placeholder="`máx. ${viewingExpense.balance.toFixed(2)}`"
                    class="w-full"
                  />
                </UFormField>
               <div class="grid gap-3 sm:grid-cols-1">
                <UFormField label="Fecha de pago">
                  <UInput v-model="paymentForm.paidAt" type="date" class="w-full" />
                </UFormField>
             
                </div>
                   <UFormField label="Empresa que realiza el pago">
                  <UInput v-model="paymentForm.paidBy" placeholder="empresa..." class="w-full" />
                </UFormField>
              </div>
              <div class="grid gap-3 sm:grid-cols-2">
                <UFormField label="Método">
                  <USelect v-model="paymentForm.method" :items="paymentMethodItems" class="w-full" />
                </UFormField>
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
            <UAlert
              v-else
              color="success"
              variant="soft"
              icon="i-lucide-circle-check"
              title="Gasto completamente pagado"
            />
          </div>

          <div class="flex justify-end pt-4">
            <UButton variant="ghost" color="neutral" @click="showPaymentsModal = false">Cerrar</UButton>
          </div>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>