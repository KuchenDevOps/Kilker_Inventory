<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import {
  PRODUCT_UNITS,
  UNIT_LABELS,
  type ApiProduct,
  type ApiProductDetail,
  type ProductUpdateInput,
  type ProductUnit
} from '~/types/inventario'

definePageMeta({ requiresRole: 'admin' })
useHead({ title: 'Editar producto · Inventario Kilker' })

const route = useRoute()
const id = Number(route.params.id)

const toast = useToast()
const { me } = useMe()
const { data: categories } = useCategories()
const apiFetch = useApiFetch()

const isAdmin = computed(() => me.value?.role === 'admin')

const { data: product, pending, error } = useFetch<ApiProductDetail>(
  `/api/products/${id}`,
  { key: `product-${id}` }
)

type FormState = {
  sku: string
  name: string
  categoryId: number | undefined
  color: string
  unit: ProductUnit
  price: number | undefined
  cost: number | undefined
  minQuantity: number | undefined
  maxQuantity: number | undefined
  barcode: string
  isActive: boolean
}

const state = reactive<FormState>({
  sku: '',
  name: '',
  categoryId: undefined,
  color: '',
  unit: 'litro',
  price: undefined,
  cost: undefined,
  minQuantity: undefined,
  maxQuantity: undefined,
  barcode: '',
  isActive: true
})
const submitting = ref(false)

const num = (v: string | null) => (v != null ? Number(v) : undefined)

// Precarga el formulario cuando llega el producto.
watch(
  product,
  (p) => {
    if (!p) return
    state.sku = p.sku
    state.name = p.name
    state.categoryId = p.categoryId ?? undefined
    state.color = p.color ?? ''
    state.unit = p.unit
    state.price = num(p.price)
    state.cost = num(p.cost)
    state.minQuantity = num(p.minQuantity)
    state.maxQuantity = num(p.maxQuantity)
    state.barcode = p.barcode ?? ''
    state.isActive = p.isActive
  },
  { immediate: true }
)

const unitItems = PRODUCT_UNITS.map((u) => ({ label: UNIT_LABELS[u], value: u }))
const categoryItems = computed(() =>
  categories.value.map((c) => ({ label: c.name, value: c.id }))
)

function validate(s: FormState): FormError[] {
  const errors: FormError[] = []
  if (!s.name.trim()) {
    errors.push({ name: 'name', message: 'El nombre es obligatorio.' })
  }
  if (!s.unit) {
    errors.push({ name: 'unit', message: 'Selecciona una unidad.' })
  }
  if (s.price == null) {
    errors.push({ name: 'price', message: 'El precio es obligatorio.' })
  }
  for (const field of ['price', 'cost', 'minQuantity', 'maxQuantity'] as const) {
    const value = s[field]
    if (value != null && value < 0) {
      errors.push({ name: field, message: 'No puede ser negativo.' })
    }
  }
  return errors
}

async function onSubmit(event: FormSubmitEvent<FormState>) {
  submitting.value = true
  const d = event.data
  const clean = (v: string) => (v.trim() ? v.trim() : null)

  const payload: ProductUpdateInput = {
    name: d.name.trim(),
    categoryId: d.categoryId ?? null,
    color: clean(d.color),
    unit: d.unit,
    price: d.price as number,
    cost: d.cost ?? null,
    minQuantity: d.minQuantity ?? null,
    maxQuantity: d.maxQuantity ?? null,
    barcode: clean(d.barcode),
    isActive: d.isActive
  }

  try {
    const updated = await apiFetch<ApiProduct>(`/api/products/${id}`, {
      method: 'PATCH',
      body: payload as unknown as Record<string, unknown>
    })
    await refreshNuxtData('products')
    toast.add({
      title: 'Producto actualizado',
      description: `${updated.sku} — ${updated.name}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    await navigateTo('/productos')
  } catch (e) {
    toast.add({
      title: 'No se pudo actualizar el producto',
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
  <UContainer class="py-8 max-w-3xl">
    <header class="mb-6">
      <UButton
        to="/productos"
        icon="i-lucide-arrow-left"
        variant="link"
        color="neutral"
        class="px-0 mb-2"
      >
        Volver al catálogo
      </UButton>
      <h1 class="text-2xl font-semibold">Editar producto</h1>
      <p class="text-sm text-muted">
        El SKU no se puede cambiar. Los campos con
        <span class="text-error">*</span> son obligatorios.
      </p>
    </header>

    <UAlert
      v-if="me && !isAdmin"
      color="warning"
      variant="soft"
      icon="i-lucide-lock"
      title="Acceso restringido"
      description="Solo un administrador puede editar productos."
      class="mb-6"
    />
    <UAlert
      v-else-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudo cargar el producto"
      :description="error.message"
      class="mb-6"
    />
    <p v-else-if="pending" class="text-sm text-muted">Cargando…</p>

    <UForm
      v-else
      :state="state"
      :validate="validate"
      :disabled="!isAdmin"
      class="space-y-6"
      @submit="onSubmit"
    >
      <!-- Identificación -->
      <UCard>
        <template #header>
          <h2 class="font-semibold">Identificación</h2>
        </template>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="SKU" name="sku" help="No editable.">
            <UInput v-model="state.sku" disabled class="w-full" />
          </UFormField>

          <UFormField label="Nombre" name="name" required>
            <UInput
              v-model="state.name"
              placeholder="Esmalte sintético blanco 1 L"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Categoría" name="categoryId">
            <USelect
              v-model="state.categoryId"
              :items="categoryItems"
              placeholder="Selecciona una categoría"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Color" name="color">
            <UInput v-model="state.color" placeholder="Blanco" class="w-full" />
          </UFormField>
        </div>
      </UCard>

      <!-- Datos comerciales -->
      <UCard>
        <template #header>
          <h2 class="font-semibold">Datos comerciales</h2>
        </template>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Unidad" name="unit" required>
            <USelect v-model="state.unit" :items="unitItems" class="w-full" />
          </UFormField>

          <UFormField label="Precio de venta (MXN)" name="price" required>
            <UInputNumber
              v-model="state.price"
              :min="0"
              :step="0.01"
              :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
              placeholder="280"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Costo (MXN)" name="cost">
            <UInputNumber
              v-model="state.cost"
              :min="0"
              :step="0.01"
              :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
              placeholder="180"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Stock mínimo"
            name="minQuantity"
            help="Dispara alerta en el dashboard cuando las existencias bajan de aquí."
          >
            <UInputNumber
              v-model="state.minQuantity"
              :min="0"
              placeholder="10"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Stock máximo"
            name="maxQuantity"
            help="Stock máximo permitido del producto."
          >
            <UInputNumber
              v-model="state.maxQuantity"
              :min="0"
              placeholder="100"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Código de barras" name="barcode">
            <UInput
              v-model="state.barcode"
              placeholder="7501234567890"
              class="w-full"
            />
          </UFormField>
        </div>

        <USeparator class="my-4" />

        <UFormField name="isActive">
          <USwitch
            v-model="state.isActive"
            label="Producto activo"
            description="Los productos inactivos no cuentan para las métricas del dashboard."
          />
        </UFormField>
      </UCard>

      <div class="flex flex-wrap justify-end gap-3">
        <UButton to="/productos" variant="ghost" color="neutral">
          Cancelar
        </UButton>
        <UButton
          type="submit"
          icon="i-lucide-save"
          color="primary"
          :loading="submitting"
          :disabled="!isAdmin"
        >
          Guardar cambios
        </UButton>
      </div>
    </UForm>
  </UContainer>
</template>
