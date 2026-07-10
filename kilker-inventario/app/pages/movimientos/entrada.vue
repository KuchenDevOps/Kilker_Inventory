<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

useHead({ title: 'Entrada de stock · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const { data: products } = useProducts()
const { data: stores } = useStores()
const apiFetch = useApiFetch()

const isAdmin = computed(() => me.value?.role === 'admin')
// Sucursal del empleado (admin la elige en el selector).
const myStore = computed(() =>
  stores.value.find((s) => s.id === me.value?.storeId)
)
// El empleado debe tener una sucursal asignada y activa para poder registrar.
const employeeNoStore = computed(() => !!me.value && !isAdmin.value && !myStore.value)
const employeeStoreInactive = computed(
  () => !!me.value && !isAdmin.value && !!myStore.value && !myStore.value.isActive
)
const employeeBlocked = computed(() => employeeNoStore.value || employeeStoreInactive.value)
const canEdit = computed(() => !!me.value && !employeeBlocked.value)

const state = reactive<{
  productId: number | undefined
  storeId: number | undefined
  quantity: number | undefined
  unitValue: number | undefined
  reason: string
  supplierInvoiceNumber: string
  supplierInvoiceDate: string
}>({
  productId: undefined,
  storeId: undefined,
  quantity: undefined,
  unitValue: undefined,
  reason: '',
  supplierInvoiceNumber: '',
  supplierInvoiceDate: ''
})
const submitting = ref(false)

const productItems = computed(() =>
  products.value.map((p) => ({
    label: `${p.sku} — ${p.name}`,
    value: p.id
  }))
)
const storeItems = computed(() =>
  stores.value
    .filter((s) => s.isActive)
    .map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)

const selectedProduct = computed(() =>
  products.value.find((p) => p.id === state.productId)
)

// Tienda destino de la entrada: la elegida por admin, o la del empleado.
const targetStore = computed(() =>
  isAdmin.value ? stores.value.find((s) => s.id === state.storeId) : myStore.value
)

const canSubmit = computed(() => {
  if (!canEdit.value) return false
  if (state.productId == null || (state.quantity ?? 0) <= 0) return false
  return isAdmin.value ? state.storeId != null : true
})

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    await apiFetch('/api/movements/entrada', {
      method: 'POST',
      body: {
        productId: state.productId,
        // El empleado no envía storeId; el backend usa la suya.
        storeId: isAdmin.value ? state.storeId : undefined,
        quantity: state.quantity,
        unitValue: state.unitValue ?? undefined,
        reason: state.reason.trim() || undefined,
        supplierInvoiceNumber: state.supplierInvoiceNumber.trim() || undefined,
        supplierInvoiceDate: state.supplierInvoiceDate || undefined
      }
    })
    await refreshNuxtData('products')
    toast.add({
      title: 'Entrada registrada',
      description: `+${state.quantity} de ${selectedProduct.value?.sku} en ${targetStore.value?.code}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    state.quantity = undefined
    state.unitValue = undefined
    state.reason = ''
    state.supplierInvoiceNumber = ''
    state.supplierInvoiceDate = ''
  } catch (e) {
    toast.add({
      title: 'No se pudo registrar la entrada',
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
  <UContainer class="py-8 max-w-2xl space-y-6">
    <header>
      <h1 class="text-2xl font-semibold">Entrada de stock</h1>
      <p class="text-sm text-muted">
        Registra existencias que ingresan a una sucursal. Genera un movimiento de
        kardex y actualiza el inventario.
      </p>
    </header>

    <UAlert
      v-if="!me"
      color="info"
      variant="soft"
      icon="i-lucide-log-in"
      title="Inicia sesión"
      description="Necesitas iniciar sesión para registrar entradas."
    />
    <UAlert
      v-else-if="employeeNoStore"
      color="warning"
      variant="soft"
      icon="i-lucide-store"
      title="Sin sucursal asignada"
      description="Tu perfil no tiene una sucursal asignada. Contacta a un administrador."
    />
    <UAlert
      v-else-if="employeeStoreInactive"
      color="warning"
      variant="soft"
      icon="i-lucide-store"
      title="Sucursal inactiva"
      description="Tu sucursal está desactivada. No puedes registrar entradas. Contacta a un administrador."
    />

    <UCard>
      <form class="space-y-5" @submit.prevent="onSubmit">
        
        <div class="grid gap-4 sm:grid-cols-2">
         <UFormField label="Producto" name="productId" required>
          <USelectMenu
            v-model="state.productId"
            :items="productItems"
            value-key="value"
            :disabled="!canEdit"
            searchable
            placeholder="Buscar producto por SKU o nombre…"
            class="w-full"
          />
          </UFormField>

          <UFormField label="Sucursal" name="storeId" :required="isAdmin">
            <USelect
              v-if="isAdmin"
              v-model="state.storeId"
              :items="storeItems"
              placeholder="Selecciona una sucursal"
              class="w-full"
            />
            <UInput
              v-else
              :model-value="myStore ? `${myStore.code} · ${myStore.name}` : '—'"
              disabled
              class="w-full"
            />
          </UFormField>

          <UFormField label="Cantidad" name="quantity" required>
            <UInputNumber
              v-model="state.quantity"
              :min="0"
              :disabled="!canEdit"
              placeholder="10"
              class="w-full"
            />
          </UFormField>
           <UFormField
            label="Costo unitario (MXN)"
            name="unitValue"
            help="Opcional. Si se omite, se usa el costo del producto."
          >
            <UInputNumber
              v-model="state.unitValue"
              :min="0"
              :step="0.01"
              :format-options="{minimumFractionDigits:0, maximumFractionDigits:2}"
              :disabled="!isAdmin"
              :placeholder="selectedProduct?.cost ?? 'costo del producto'"
              class="w-full"
            />
          </UFormField>

        </div>

        <UFormField label="Motivo / referencia" name="reason">
          <UInput
            v-model="state.reason"
            :disabled="!canEdit"
            placeholder="Compra a proveedor, factura #…"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Número de factura" name="supplierInvoiceNumber">
          <UInput
            v-model="state.supplierInvoiceNumber"
            :disabled="!canEdit"
            placeholder="A-12345"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Fecha de factura" name="supplierInvoiceDate">
          <UInput
            v-model="state.supplierInvoiceDate"
            type="date"
            :disabled="!canEdit"
            class="w-full"
          />
        </UFormField>
        <div
          v-if="selectedProduct"
          class="rounded-lg bg-elevated/50 px-4 py-3 text-sm text-muted"
        >
          {{ selectedProduct.name }} · {{ UNIT_LABELS[selectedProduct.unit] }} ·
          existencia total actual:
          <span class="font-medium text-default">{{ selectedProduct.totalStock }}</span>
        </div>

        <div class="flex justify-end">
          <UButton
            type="submit"
            icon="i-lucide-arrow-down-to-line"
            color="primary"
            :loading="submitting"
            :disabled="!canSubmit"
          >
            Registrar entrada
          </UButton>
        </div>
      </form>
    </UCard>
  </UContainer>
</template>
