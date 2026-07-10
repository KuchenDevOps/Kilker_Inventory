<script setup lang="ts">
useHead({ title: 'Historial de entradas · Inventario Kilker' })

const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { movements, pending, error, storeId, from, to, search, refresh } = useMovements()
const { data: stores } = useStores()
const { data: products } = useProducts()
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

// Opciones para los selects del modal de edición (todas las sucursales/productos,
// sin importar el filtro activo de la tabla).
const productItems = computed(() =>
  products.value.map((p) => ({ label: `${p.sku} · ${p.name}`, value: p.id }))
)
const storeEditItems = computed(() => stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id })))

const qtyFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
const dayFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })
function fmtDate(s: string | null) {
  return s ? dateFmt.format(new Date(s)) : '—'
}
function fmtDay(s: string | null) {
  return s ? dayFmt.format(new Date(`${s}T00:00:00`)) : '—'
}

// ───────────────────────────────────────────────
//  EDICIÓN DE ENTRADA (solo admin)
// ───────────────────────────────────────────────
const editingId = ref<number | null>(null)
const showEditModal = ref(false)
const submittingEdit = ref(false)

const editForm = reactive({
  productId: 0,
  storeId: 0,
  quantity: 0,
  unitValue: 0,
  reason: '',
  supplierInvoiceNumber: '',
  supplierInvoiceDate: ''
})

function openEdit(m: (typeof movements.value)[number]) {
  editingId.value = m.id
  Object.assign(editForm, {
    productId: m.productId,
    storeId: m.storeId,
    quantity: Number(m.quantity),
    unitValue: Number(m.unitValue),
    reason: '',
    supplierInvoiceNumber: m.supplierInvoiceNumber ?? '',
    supplierInvoiceDate: m.supplierInvoiceDate ?? ''
  })
  showEditModal.value = true
}

const canSubmitEdit = computed(
  () => editForm.productId > 0 && editForm.storeId > 0 && editForm.quantity > 0
)

async function onSubmitEdit() {
  if (!canSubmitEdit.value || editingId.value == null) return
  submittingEdit.value = true
  try {
    await apiFetch(`/api/movements/${editingId.value}`, {
      method: 'PATCH',
      body: {
        productId: editForm.productId,
        storeId: editForm.storeId,
        quantity: editForm.quantity,
        unitValue: editForm.unitValue,
        reason: editForm.reason.trim() || null,
        supplierInvoiceNumber: editForm.supplierInvoiceNumber.trim() || null,
        supplierInvoiceDate: editForm.supplierInvoiceDate || null
      }
    })
    toast.add({ title: 'Entrada actualizada', color: 'success', icon: 'i-lucide-circle-check' })
    showEditModal.value = false
    await refresh()
    await refreshNuxtData('products')
  } catch (e) {
    toast.add({
      title: 'No se pudo actualizar la entrada',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submittingEdit.value = false
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
          <template v-if="!isAdmin"> · tu sucursal</template>
        </p>
      </div>
      <UButton to="/movimientos/entrada" icon="i-lucide-plus" color="primary">
        Nueva entrada
      </UButton>
    </header>

    <div class="space-y-3">
      <FiltroPeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        search-placeholder="Buscar producto, SKU, factura, sucursal…"
      />
      <USelect v-if="isAdmin" v-model="storeFilter" :items="storeItems" class="w-60" />
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
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium">Producto</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium text-right">Cantidad</th>
              <th class="px-4 py-3 font-medium text-right">Total</th>
              <th class="px-4 py-3 font-medium">Factura prov.</th>
              <th class="px-4 py-3 font-medium">Fecha factura</th>
              <th class="px-4 py-3 font-medium">Registró</th>
              <th v-if="isAdmin" class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td :colspan="isAdmin ? 9 : 8" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!movements.length">
              <td :colspan="isAdmin ? 9 : 8" class="px-4 py-8 text-center text-muted">
                Sin entradas para el filtro actual.
              </td>
            </tr>
            <tr v-for="m in movements" v-else :key="m.id" class="hover:bg-elevated/50">
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
                {{ qtyFmt.format(Number(m.totalValue)) }}
              </td>
              <td class="px-4 py-3 text-muted">{{ m.supplierInvoiceNumber ?? '—' }}</td>
              <td class="px-4 py-3 text-muted whitespace-nowrap">
                {{ fmtDay(m.supplierInvoiceDate) }}
              </td>
              <td class="px-4 py-3 text-muted">{{ m.createdByName ?? '—' }}</td>
              <td v-if="isAdmin" class="px-4 py-3 text-right">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  @click="openEdit(m)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <!-- Modal de edición (solo admin) -->
    <UModal v-model:open="showEditModal">
      <template #content>
        <UCard>
          <template #header>
            <h2 class="font-semibold">Editar entrada</h2>
          </template>

          <form class="space-y-4" @submit.prevent="onSubmitEdit">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Producto" required>
                <USelect v-model="editForm.productId" :items="productItems" class="w-full" />
              </UFormField>
              <UFormField label="Sucursal" required>
                <USelect v-model="editForm.storeId" :items="storeEditItems" class="w-full" />
              </UFormField>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Cantidad" required>
                <UInput v-model.number="editForm.quantity" type="number" step="0.001" min="0" class="w-full" />
              </UFormField>
              <UFormField label="Valor unitario">
                <UInput v-model.number="editForm.unitValue" type="number" step="0.01" min="0" class="w-full" />
              </UFormField>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Factura del proveedor">
                <UInput v-model="editForm.supplierInvoiceNumber" class="w-full" />
              </UFormField>
              <UFormField label="Fecha de factura">
                <UInput v-model="editForm.supplierInvoiceDate" type="date" class="w-full" />
              </UFormField>
            </div>

            <UFormField label="Motivo/Referencia">
              <UTextarea v-model="editForm.reason" placeholder="compra proveedor, # factura..." class="w-full" />
            </UFormField>

            <div class="flex justify-end gap-2 pt-2">
              <UButton type="button" variant="ghost" color="neutral" @click="showEditModal = false">
                Cancelar
              </UButton>
              <UButton type="submit" color="primary" :loading="submittingEdit" :disabled="!canSubmitEdit">
                Guardar cambios
              </UButton>
            </div>
          </form>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>