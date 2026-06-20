<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import {
  PRODUCT_BASES,
  PRODUCT_UNITS,
  type NewProductInput,
  type ProductBase,
  type ProductUnit
} from '~/types/inventario'

useHead({ title: 'Nuevo producto · Inventario Kilker' })

const store = useInventarioStore()
const toast = useToast()

type FormState = {
  sku: string
  name: string
  brand: string
  category: string
  color: string
  colorCode: string
  base: ProductBase | undefined
  finish: string
  volume: number | undefined
  unit: ProductUnit
  barcode: string
  price: number | undefined
  cost: number | undefined
  minQuantity: number | undefined
  isActive: boolean
}

function emptyState(): FormState {
  return {
    sku: '',
    name: '',
    brand: '',
    category: '',
    color: '',
    colorCode: '',
    base: undefined,
    finish: '',
    volume: undefined,
    unit: 'L',
    barcode: '',
    price: undefined,
    cost: undefined,
    minQuantity: undefined,
    isActive: true
  }
}

const state = reactive<FormState>(emptyState())
const submitting = ref(false)

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const baseItems = PRODUCT_BASES.map((b) => ({ label: capitalize(b), value: b }))
const unitItems = PRODUCT_UNITS.map((u) => ({ label: u, value: u }))

function validate(s: FormState): FormError[] {
  const errors: FormError[] = []
  if (!s.sku.trim()) {
    errors.push({ name: 'sku', message: 'El SKU es obligatorio.' })
  } else if (store.skuExists(s.sku)) {
    errors.push({ name: 'sku', message: 'Ya existe un producto con este SKU.' })
  }
  if (!s.name.trim()) {
    errors.push({ name: 'name', message: 'El nombre es obligatorio.' })
  }
  if (!s.unit) {
    errors.push({ name: 'unit', message: 'Selecciona una unidad.' })
  }
  for (const field of ['volume', 'price', 'cost', 'minQuantity'] as const) {
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
  const clean = (v: string) => (v.trim() ? v.trim() : undefined)

  const payload: NewProductInput = {
    sku: d.sku.trim(),
    name: d.name.trim(),
    brand: clean(d.brand),
    category: clean(d.category),
    color: clean(d.color),
    colorCode: clean(d.colorCode),
    base: d.base,
    finish: clean(d.finish),
    volume: d.volume,
    unit: d.unit,
    barcode: clean(d.barcode),
    price: d.price,
    cost: d.cost,
    minQuantity: d.minQuantity,
    isActive: d.isActive
  }

  const created = store.addProduct(payload)
  toast.add({
    title: 'Producto creado',
    description: `${created.sku} — ${created.name}`,
    color: 'success',
    icon: 'i-lucide-circle-check'
  })
  submitting.value = false
  await navigateTo('/dashboard')
}

function onReset() {
  Object.assign(state, emptyState())
}
</script>

<template>
  <UContainer class="py-8 max-w-3xl">
    <header class="mb-6">
      <UButton
        to="/dashboard"
        icon="i-lucide-arrow-left"
        variant="link"
        color="neutral"
        class="px-0 mb-2"
      >
        Volver al dashboard
      </UButton>
      <h1 class="text-2xl font-semibold">Nuevo producto</h1>
      <p class="text-sm text-muted">
        Alta de un producto del catálogo. Los campos con
        <span class="text-error">*</span> son obligatorios.
      </p>
    </header>

    <UForm
      :state="state"
      :validate="validate"
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
            <UInput
              v-model="state.sku"
              placeholder="ESM-BLA-1L"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Nombre" name="name" required>
            <UInput
              v-model="state.name"
              placeholder="Esmalte sintético blanco 1 L"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Marca" name="brand">
            <UInput v-model="state.brand" placeholder="Comex" class="w-full" />
          </UFormField>

          <UFormField label="Categoría" name="category">
            <UInput
              v-model="state.category"
              placeholder="Esmaltes"
              class="w-full"
            />
          </UFormField>
        </div>
      </UCard>

      <!-- Características de pintura -->
      <UCard>
        <template #header>
          <h2 class="font-semibold">Características</h2>
        </template>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Color" name="color">
            <UInput v-model="state.color" placeholder="Blanco" class="w-full" />
          </UFormField>

          <UFormField label="Código de color" name="colorCode">
            <UInput
              v-model="state.colorCode"
              placeholder="N-100"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Base" name="base">
            <USelect
              v-model="state.base"
              :items="baseItems"
              placeholder="Selecciona una base"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Acabado" name="finish">
            <UInput
              v-model="state.finish"
              placeholder="Brillante"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Volumen" name="volume">
            <UInputNumber
              v-model="state.volume"
              :min="0"
              :step="0.5"
              placeholder="1"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Unidad" name="unit" required>
            <USelect
              v-model="state.unit"
              :items="unitItems"
              class="w-full"
            />
          </UFormField>
        </div>
      </UCard>

      <!-- Datos comerciales -->
      <UCard>
        <template #header>
          <h2 class="font-semibold">Datos comerciales</h2>
        </template>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Precio de venta (MXN)" name="price">
            <UInputNumber
              v-model="state.price"
              :min="0"
              placeholder="280"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Costo (MXN)" name="cost">
            <UInputNumber
              v-model="state.cost"
              :min="0"
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
        <UButton
          type="button"
          variant="ghost"
          color="neutral"
          @click="onReset"
        >
          Limpiar
        </UButton>
        <UButton
          type="submit"
          icon="i-lucide-save"
          color="primary"
          :loading="submitting"
        >
          Guardar producto
        </UButton>
      </div>
    </UForm>
  </UContainer>
</template>
