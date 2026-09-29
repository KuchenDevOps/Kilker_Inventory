<script setup lang="ts">
import type { ApiPurchaseOrder, ApiPurchaseOrderDetail, PurchaseOrderStatus } from '~/types/inventario'
import {
  PURCHASE_ORDER_APPROVER_ROLES,
  PURCHASE_ORDER_STATUS_LABELS,
  purchaseOrderFolio
} from '~/types/inventario'

useHead({ title: 'Pedidos a proveedores · Inventario Kilker' })

const { orders, total, page, pageSize, pending, error, status, storeId, q, from, to, refresh } =
  usePurchaseOrdersHistory()
const { me, canWrite, seesAllStores, isStoreScoped } = useMe()
const { products } = useAllProducts() // ya excluye muestras
const { data: stores } = useStores()

const toast = useToast()
const apiFetch = useApiFetch()

const canDecide = computed(
  () => !!me.value && PURCHASE_ORDER_APPROVER_ROLES.includes(me.value.role)
)

const currencyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const money = (v: number | string) => currencyFmt.format(Number(v))
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })
const fmtDate = (s: string) => dateFmt.format(new Date(s))

const STATUS_COLOR: Record<PurchaseOrderStatus, 'warning' | 'success' | 'error'> = {
  pendiente: 'warning',
  aprobado: 'success',
  rechazado: 'error'
}

// ───────────────────────────────────────────────
//  FILTROS
// ───────────────────────────────────────────────
const statusItems = [
  { label: 'Todos', value: 'todos' },
  { label: 'Pendientes', value: 'pendiente' },
  { label: 'Aprobados', value: 'aprobado' },
  { label: 'Rechazados', value: 'rechazado' }
]
const storeFilterItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...(stores.value ?? []).map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])
const filtersActive = computed(
  () => status.value !== 'todos' || !!storeId.value || !!q.value.trim() || !!from.value || !!to.value
)
function clearFilters() {
  // Todo en la misma tick: una sola recarga.
  status.value = 'todos'
  storeId.value = 0
  q.value = ''
  from.value = undefined
  to.value = undefined
}

// ───────────────────────────────────────────────
//  MODAL ALTA / EDICIÓN / CONSULTA
// ───────────────────────────────────────────────
interface FormLine {
  key: number
  productId: number | undefined
  quantity: number
  unitPrice: number
}

const showModal = ref(false)
const loadingId = ref<number | null>(null)
const submitting = ref(false)
const editing = ref<ApiPurchaseOrderDetail | null>(null) // null = alta nueva

let lineKey = 0
const form = reactive({
  storeId: undefined as number | undefined,
  supplierName: '',
  supplierContact: '',
  note: '',
  lines: [] as FormLine[]
})

/** Solo lectura si ya se decidió o si el rol no escribe. */
const readonly = computed(
  () => !canWrite.value || (editing.value != null && editing.value.status !== 'pendiente')
)

const productItems = computed(() =>
  products.value
    .filter((p) => p.isActive)
    .map((p) => ({ label: `${p.sku} — ${p.name}`, value: p.id }))
)
const productById = computed(() => new Map(products.value.map((p) => [p.id, p])))

const storeFormItems = computed(() =>
  (stores.value ?? []).filter((s) => s.isActive).map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)

function newLine(): FormLine {
  return { key: ++lineKey, productId: undefined, quantity: 1, unitPrice: 0 }
}
function addLine() {
  form.lines.push(newLine())
}
function removeLine(key: number) {
  form.lines = form.lines.filter((l) => l.key !== key)
}

/** Al elegir producto, sugiere su costo si el renglón aún no tiene precio. */
function onProductChange(line: FormLine, id: number | undefined) {
  line.productId = id
  const cost = id != null ? Number(productById.value.get(id)?.cost ?? 0) : 0
  if (!line.unitPrice && cost > 0) line.unitPrice = cost
}

// Previsualización: el total real lo calcula Postgres (line_total).
const lineAmount = (l: FormLine) => Math.round((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * 100) / 100
const formTotal = computed(() => form.lines.reduce((s, l) => s + lineAmount(l), 0))

const duplicatedProduct = computed(() => {
  const ids = form.lines.map((l) => l.productId).filter((id) => id != null)
  return new Set(ids).size !== ids.length
})

const canSubmit = computed(
  () =>
    !readonly.value &&
    form.supplierName.trim().length > 0 &&
    (!seesAllStores.value || form.storeId != null) &&
    form.lines.length > 0 &&
    form.lines.every((l) => l.productId != null && l.quantity > 0 && l.unitPrice >= 0) &&
    !duplicatedProduct.value
)

function openCreate() {
  editing.value = null
  Object.assign(form, {
    storeId: isStoreScoped.value ? me.value?.storeId ?? undefined : undefined,
    supplierName: '',
    supplierContact: '',
    note: '',
    lines: [newLine()]
  })
  showModal.value = true
}

async function fetchDetail(id: number) {
  return await apiFetch<ApiPurchaseOrderDetail>(`/api/purchase-orders/${id}`)
}

async function openEdit(o: ApiPurchaseOrder) {
  // Id propio: `editing` se asigna hasta que llega el detalle, así que no sirve
  // para saber qué renglón está cargando.
  loadingId.value = o.id
  try {
    const d = await fetchDetail(o.id)
    editing.value = d
    Object.assign(form, {
      storeId: d.storeId,
      supplierName: d.supplierName,
      supplierContact: d.supplierContact ?? '',
      note: d.note ?? '',
      lines: d.items.map((it) => ({
        key: ++lineKey,
        productId: it.productId,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice)
      }))
    })
    showModal.value = true
  } catch (e) {
    toast.add({ title: 'No se pudo abrir el pedido', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    loadingId.value = null
  }
}

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const body = {
      storeId: form.storeId ?? null,
      supplierName: form.supplierName.trim(),
      supplierContact: form.supplierContact.trim() || null,
      note: form.note.trim() || null,
      items: form.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice }))
    }
    if (editing.value) {
      await apiFetch(`/api/purchase-orders/${editing.value.id}`, { method: 'PATCH', body })
      toast.add({ title: 'Pedido actualizado', color: 'success', icon: 'i-lucide-circle-check' })
    } else {
      await apiFetch('/api/purchase-orders', { method: 'POST', body })
      toast.add({ title: 'Pedido creado', color: 'success', icon: 'i-lucide-circle-check' })
    }
    showModal.value = false
    await refresh()
  } catch (e) {
    toast.add({ title: 'No se pudo guardar el pedido', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    submitting.value = false
  }
}

// ───────────────────────────────────────────────
//  APROBAR / RECHAZAR
// ───────────────────────────────────────────────
const deciding = ref<ApiPurchaseOrder | null>(null)
const decisionStatus = ref<'aprobado' | 'rechazado'>('aprobado')
const decisionNote = ref('')
const submittingDecision = ref(false)

function openDecision(o: ApiPurchaseOrder, s: 'aprobado' | 'rechazado') {
  deciding.value = o
  decisionStatus.value = s
  decisionNote.value = ''
}

async function confirmDecision() {
  if (!deciding.value) return
  submittingDecision.value = true
  try {
    await apiFetch(`/api/purchase-orders/${deciding.value.id}/decision`, {
      method: 'POST',
      body: { status: decisionStatus.value, note: decisionNote.value.trim() || null }
    })
    toast.add({
      title: decisionStatus.value === 'aprobado' ? 'Pedido aprobado' : 'Pedido rechazado',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    deciding.value = null
    await refresh()
  } catch (e) {
    toast.add({ title: 'No se pudo registrar la decisión', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    submittingDecision.value = false
  }
}

// ───────────────────────────────────────────────
//  PDF (pdfmake bajo demanda, como el ticket de venta)
// ───────────────────────────────────────────────
const downloadingId = ref<number | null>(null)

/**
 * `pedido-<proveedor>-<AAAA-MM-DD>.pdf`. Sin el folio: el archivo se le manda
 * al proveedor y el folio es control interno. Se quitan los caracteres que
 * Windows no acepta en un nombre de archivo.
 */
function pdfFileName(o: ApiPurchaseOrder) {
  const supplier = o.supplierName
    .replace(/[\\/:*?"<>|]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
  const day = new Date(o.createdAt).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' })
  return `pedido-${supplier || 'proveedor'}-${day}.pdf`
}

async function downloadPdf(o: ApiPurchaseOrder) {
  downloadingId.value = o.id
  try {
    const [detail, { default: pdfMake }, { default: vfs }, { KILKER_LOGO_PNG }] = await Promise.all([
      fetchDetail(o.id),
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
      import('~/utils/brandLogo')
    ])
    pdfMake.addVirtualFileSystem(vfs)
    pdfMake
      .createPdf(buildPurchaseOrderDoc(detail, KILKER_LOGO_PNG))
      .download(pdfFileName(o))
  } catch (e) {
    toast.add({ title: 'No se pudo generar el PDF', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    downloadingId.value = null
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Pedidos a proveedores</h1>
        <p class="text-sm text-muted">{{ total }} pedido(s) · no afectan el inventario</p>
      </div>
      <UButton v-if="canWrite" icon="i-lucide-plus" color="primary" @click="openCreate">
        Nuevo pedido
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los pedidos"
      :description="error"
    />

    <div class="flex flex-wrap items-center gap-3">
      <FiltroPeriodo
        v-model:search="q"
        v-model:from="from"
        v-model:to="to"
        search-placeholder="Buscar por proveedor o folio…"
      />
      <USelect v-model="status" :items="statusItems" class="w-40" />
      <USelect
        v-if="seesAllStores"
        v-model="storeId"
        :items="storeFilterItems"
        placeholder="Todas las sucursales"
        class="w-56"
      />
      <BotonLimpiarFiltros :active="filtersActive" @clear="clearFilters" />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Folio</th>
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium">Proveedor</th>
              <th class="px-4 py-3 font-medium text-right">Productos</th>
              <th class="px-4 py-3 font-medium text-right">Total</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="8" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!orders.length">
              <td colspan="8" class="px-4 py-8 text-center text-muted">Sin pedidos.</td>
            </tr>
            <tr v-for="o in orders" v-else :key="o.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 font-mono text-xs">{{ purchaseOrderFolio(o.id) }}</td>
              <td class="px-4 py-3 text-muted">{{ fmtDate(o.createdAt) }}</td>
              <td class="px-4 py-3 text-muted">{{ o.storeCode }}</td>
              <td class="px-4 py-3">
                <div class="font-medium">{{ o.supplierName }}</div>
                <div v-if="o.supplierContact" class="text-xs text-muted">{{ o.supplierContact }}</div>
              </td>
              <td class="px-4 py-3 text-right">{{ o.itemsCount }}</td>
              <td class="px-4 py-3 text-right font-medium">{{ money(o.total) }}</td>
              <td class="px-4 py-3 text-center">
                <UTooltip
                  :disabled="o.status === 'pendiente'"
                  :text="`${o.decidedByName ?? '—'}${o.decisionNote ? ': ' + o.decisionNote : ''}`"
                >
                  <UBadge
                    :label="PURCHASE_ORDER_STATUS_LABELS[o.status]"
                    :color="STATUS_COLOR[o.status]"
                    variant="subtle"
                  />
                </UTooltip>
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-end gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    :icon="canWrite && o.status === 'pendiente' ? 'i-lucide-pencil' : 'i-lucide-eye'"
                    :loading="loadingId === o.id"
                    @click="openEdit(o)"
                  />
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-file-down"
                    :loading="downloadingId === o.id"
                    @click="downloadPdf(o)"
                  />
                  <template v-if="canDecide && o.status === 'pendiente'">
                    <UButton
                      size="xs"
                      color="success"
                      variant="soft"
                      icon="i-lucide-check"
                      label="Aprobar"
                      @click="openDecision(o, 'aprobado')"
                    />
                    <UButton
                      size="xs"
                      color="error"
                      variant="soft"
                      icon="i-lucide-x"
                      label="Rechazar"
                      @click="openDecision(o, 'rechazado')"
                    />
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <div class="flex flex-col items-center gap-2">
      <p class="text-xs text-muted">Mostrando {{ orders.length }} de {{ total }} pedidos</p>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>

    <!-- Modal alta / edición / consulta -->
    <UModal v-model:open="showModal" :ui="{ content: 'sm:max-w-3xl' }">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-semibold">
                <template v-if="!editing">Nuevo pedido</template>
                <template v-else>
                  {{ readonly ? 'Pedido' : 'Editar pedido' }} {{ purchaseOrderFolio(editing.id) }}
                </template>
              </h2>
              <UBadge
                v-if="editing"
                :label="PURCHASE_ORDER_STATUS_LABELS[editing.status]"
                :color="STATUS_COLOR[editing.status]"
                variant="subtle"
              />
            </div>
          </template>

          <form class="space-y-4" @submit.prevent="onSubmit">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Empresa / proveedor" required>
                <UInput v-model="form.supplierName" :disabled="readonly" placeholder="Nombre de la empresa" class="w-full" />
              </UFormField>
              <UFormField label="Contacto">
                <UInput v-model="form.supplierContact" :disabled="readonly" placeholder="Correo, teléfono o persona" class="w-full" />
              </UFormField>
            </div>

            <UFormField v-if="seesAllStores" label="Sucursal que pide" required>
              <USelect
                v-model="form.storeId"
                :items="storeFormItems"
                :disabled="readonly"
                placeholder="Elige sucursal"
                class="w-full"
              />
            </UFormField>

            <!-- Líneas -->
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">Productos</span>
                <UButton v-if="!readonly" size="xs" variant="soft" icon="i-lucide-plus" @click="addLine">
                  Agregar producto
                </UButton>
              </div>

              <div
                v-for="line in form.lines"
                :key="line.key"
                class="grid grid-cols-12 items-end gap-2 rounded-md border border-default p-2"
              >
                <UFormField label="Producto" class="col-span-12 sm:col-span-6">
                  <USelectMenu
                    :model-value="line.productId"
                    :items="productItems"
                    value-key="value"
                    :disabled="readonly"
                    placeholder="Buscar por SKU o nombre…"
                    class="w-full"
                    @update:model-value="(v: number | undefined) => onProductChange(line, v)"
                  />
                </UFormField>
                <UFormField label="Cantidad" class="col-span-4 sm:col-span-2">
                  <UInput v-model.number="line.quantity" type="number" min="0" step="any" :disabled="readonly" class="w-full" />
                </UFormField>
                <UFormField label="Precio" class="col-span-4 sm:col-span-2">
                  <UInput v-model.number="line.unitPrice" type="number" min="0" step="0.01" :disabled="readonly" class="w-full" />
                </UFormField>
                <div class="col-span-3 sm:col-span-1 pb-2 text-right text-sm font-medium">
                  {{ money(lineAmount(line)) }}
                </div>
                <div class="col-span-1 pb-1 text-right">
                  <UButton
                    v-if="!readonly"
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-trash-2"
                    :disabled="form.lines.length === 1"
                    @click="removeLine(line.key)"
                  />
                </div>
              </div>

              <p v-if="duplicatedProduct" class="text-xs text-error">
                Hay productos repetidos: junta las cantidades en un solo renglón.
              </p>
            </div>

            <div class="flex justify-end text-base font-semibold">
              Total: {{ money(formTotal) }}
            </div>

            <UFormField label="Nota">
              <UTextarea v-model="form.note" :disabled="readonly" placeholder="Condiciones, fecha de entrega…" class="w-full" />
            </UFormField>

            <p v-if="editing && editing.status !== 'pendiente'" class="text-xs text-muted">
              {{ PURCHASE_ORDER_STATUS_LABELS[editing.status] }} por {{ editing.decidedByName ?? '—' }}
              <template v-if="editing.decidedAt"> el {{ fmtDate(editing.decidedAt) }}</template>
              <template v-if="editing.decisionNote"> — "{{ editing.decisionNote }}"</template>
            </p>

            <div class="flex justify-end gap-2 pt-2">
              <UButton type="button" variant="ghost" color="neutral" @click="showModal = false">
                {{ readonly ? 'Cerrar' : 'Cancelar' }}
              </UButton>
              <UButton v-if="!readonly" type="submit" color="primary" :loading="submitting" :disabled="!canSubmit">
                Guardar
              </UButton>
            </div>
          </form>
        </UCard>
      </template>
    </UModal>

    <!-- Modal aprobar / rechazar -->
    <UModal :open="deciding != null" @update:open="(v: boolean) => { if (!v) deciding = null }">
      <template #content>
        <UCard v-if="deciding">
          <template #header>
            <h2 class="font-semibold">
              {{ decisionStatus === 'aprobado' ? 'Aprobar' : 'Rechazar' }} pedido
              {{ purchaseOrderFolio(deciding.id) }}
            </h2>
          </template>
          <div class="space-y-4">
            <p class="text-sm text-muted">
              {{ deciding.supplierName }} · {{ money(deciding.total) }}. Una vez decidido, el pedido
              ya no se puede editar.
            </p>
            <UFormField label="Nota (opcional)">
              <UTextarea v-model="decisionNote" class="w-full" />
            </UFormField>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" color="neutral" @click="deciding = null">Cancelar</UButton>
              <UButton
                :color="decisionStatus === 'aprobado' ? 'success' : 'error'"
                :loading="submittingDecision"
                @click="confirmDecision"
              >
                {{ decisionStatus === 'aprobado' ? 'Aprobar' : 'Rechazar' }}
              </UButton>
            </div>
          </div>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>