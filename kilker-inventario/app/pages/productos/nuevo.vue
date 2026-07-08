<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import {
  PRODUCT_UNITS,
  UNIT_LABELS,
  type ApiProduct,
  type NewProductInput,
  type ProductUnit
} from '~/types/inventario'

definePageMeta({ requiresRole: 'admin' })
useHead({ title: 'Nuevo producto · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const { data: categories } = useCategories()
const { data: products } = useProducts()
const apiFetch = useApiFetch()

const isAdmin = computed(() => me.value?.role === 'admin')

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

function emptyState(): FormState {
  return {
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
  }
}

const state = reactive<FormState>(emptyState())
const submitting = ref(false)

const unitItems = PRODUCT_UNITS.map((u) => ({ label: UNIT_LABELS[u], value: u }))
const categoryItems = computed(() =>
  categories.value.map((c) => ({ label: c.name, value: c.id }))
)

function validate(s: FormState): FormError[] {
  const errors: FormError[] = []
  if (!s.sku.trim()) {
    errors.push({ name: 'sku', message: 'El SKU es obligatorio.' })
  } else if (
    products.value.some((p) => p.sku.toLowerCase() === s.sku.trim().toLowerCase())
  ) {
    errors.push({ name: 'sku', message: 'Ya existe un producto con este SKU.' })
  }
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

  const payload: NewProductInput = {
    sku: d.sku.trim(),
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
    const created = await apiFetch<ApiProduct>('/api/products', {
      method: 'POST',
      body: payload as unknown as Record<string, unknown>
    })
    await refreshNuxtData('products')
    toast.add({
      title: 'Producto creado',
      description: `${created.sku} — ${created.name}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    await navigateTo('/productos')
  } catch (e) {
    toast.add({
      title: 'No se pudo crear el producto',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}

function onReset() {
  Object.assign(state, emptyState())
}

const file = ref<File | null>(null)

const handleFileUpload = (event: Event) => {
  const target = event.target as HTMLInputElement | null
  file.value = target?.files?.[0] ?? null
}

const submitCsv = async () => {
  if (!file.value) return alert('Please select a file');

  const formData = new FormData();
  formData.append('csvFile', file.value);

  try {
    // $fetch automatically sets the multipart/form-data headers
    const response = await $fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });
    console.log('Success:', response);
  } catch (error) {
    console.error('Upload failed:', error);
  }
};
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
      <h1 class="text-2xl font-semibold">Nuevo producto</h1>
      <p class="text-sm text-muted">
        Alta de un producto del catálogo. Los campos con
        <span class="text-error">*</span> son obligatorios.
      </p>
    </header>

    <UAlert
      v-if="me && !isAdmin"
      color="warning"
      variant="soft"
      icon="i-lucide-lock"
      title="Acceso restringido"
      description="Solo un administrador puede dar de alta productos."
      class="mb-6"
    />
    <UAlert
      v-else-if="!me"
      color="info"
      variant="soft"
      icon="i-lucide-log-in"
      title="Inicia sesión"
      description="Necesitas iniciar sesión como administrador para crear productos."
      class="mb-6"
    />

    <UForm
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
          <UFormField label="SKU" name="sku" required>
            <UInput v-model="state.sku" placeholder="ESM-BLA-1L" class="w-full" />
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
              :format-options="{minimumFractionDigits:0, maximumFractionDigits:2}"
              placeholder="280"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Costo (MXN)" name="cost">
            <UInputNumber
              v-model="state.cost"
              :min="0"
              :step="0.01"
              :format-options="{minimumFractionDigits:0, maximumFractionDigits:2}"
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
            label="Stock Maximo"
            name="maxQuantity"
            help="Stock Maximo Permitido del producto"
          >
            <UInputNumber
              v-model="state.maxQuantity"
              :min="0"
              placeholder="10"
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
            <div>
    <input type="file" accept=".csv" @change="handleFileUpload" />
        <UButton  type="submit" @click="submitCsv">Upload CSV</Ubutton>
    </div>
      </UCard>

      <div class="flex flex-wrap justify-end gap-3">
        <UButton type="button" variant="ghost" color="neutral" @click="onReset">
          Limpiar
        </UButton>
        <UButton
          type="submit"
          icon="i-lucide-save"
          color="primary"
          :loading="submitting"
          :disabled="!isAdmin"
        >
          Guardar producto
        </UButton>
      </div>
    </UForm>
  </UContainer>
</template>
