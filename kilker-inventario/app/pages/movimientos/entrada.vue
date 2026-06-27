<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

definePageMeta({ requiresRole: 'admin' })
useHead({ title: 'Entrada de stock · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const { data: products } = useProducts()
const { data: stores } = useStores()
const apiFetch = useApiFetch()

const isAdmin = computed(() => me.value?.role === 'admin')

const state = reactive<{
  productId: number | undefined
  storeId: number | undefined
  quantity: number | undefined
  reason: string
  supplierInvoiceNumber: string
  supplierInvoiceDate: string
}>({
  productId: undefined,
  storeId: undefined,
  quantity: undefined,
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
  stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)

const selectedProduct = computed(() =>
  products.value.find((p) => p.id === state.productId)
)

const canSubmit = computed(
  () =>
    isAdmin.value &&
    state.productId != null &&
    state.storeId != null &&
    (state.quantity ?? 0) > 0
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    await apiFetch('/api/movements/entrada', {
      method: 'POST',
      body: {
        productId: state.productId,
        storeId: state.storeId,
        quantity: state.quantity,
        reason: state.reason.trim() || undefined,
        supplierInvoiceNumber: state.supplierInvoiceNumber.trim() || undefined,
        supplierInvoiceDate: state.supplierInvoiceDate || undefined,
      }
    })
    await refreshNuxtData('products')
    const store = stores.value.find((s) => s.id === state.storeId)
    toast.add({
      title: 'Entrada registrada',
      description: `+${state.quantity} de ${selectedProduct.value?.sku} en ${store?.code}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    state.quantity = undefined
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
      v-if="me && !isAdmin"
      color="warning"
      variant="soft"
      icon="i-lucide-lock"
      title="Acceso restringido"
      description="Solo un administrador puede registrar entradas de stock."
    />
    <UAlert
      v-else-if="!me"
      color="info"
      variant="soft"
      icon="i-lucide-log-in"
      title="Inicia sesión"
      description="Necesitas iniciar sesión como administrador para registrar entradas."
    />

    <UCard>
      <form class="space-y-5" @submit.prevent="onSubmit">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Producto" name="productId" required>
            <USelect
              v-model="state.productId"
              :items="productItems"
              :disabled="!isAdmin"
              placeholder="Selecciona un producto"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Sucursal" name="storeId" required>
            <USelect
              v-model="state.storeId"
              :items="storeItems"
              :disabled="!isAdmin"
              placeholder="Selecciona una sucursal"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Cantidad" name="quantity" required>
            <UInputNumber
              v-model="state.quantity"
              :min="0"
              :disabled="!isAdmin"
              placeholder="10"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="Motivo / referencia" name="reason">
          <UInput
            v-model="state.reason"
            :disabled="!isAdmin"
            placeholder="Compra a proveedor, factura #…"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Número de factura" name="supplierInvoiceNumber">
          <UInput
            v-model="state.supplierInvoiceNumber"
            :disabled="!isAdmin"
            placeholder="A-12345"
            class="w-full"
          />
        </UFormField>
        
        <UFormField label="Fecha de factura" name="supplierInvoiceDate">
          <UInput
            v-model="state.supplierInvoiceDate"
            type="date"
            :disabled="!isAdmin"
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
