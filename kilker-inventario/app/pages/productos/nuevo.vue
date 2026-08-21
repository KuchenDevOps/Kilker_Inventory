<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import {
  PRODUCT_UNITS,
  UNIT_LABELS,
  type ApiProduct,
  type NewProductInput,
  type ProductUnit
} from '~/types/inventario'

// Catálogo compartido: lo da de alta el admin de empresa y el de tienda.
definePageMeta({ requiresRole: ['admin', 'admin_tienda'] })
useHead({ title: 'Nuevo producto · Inventario Kilker' })
const apiFetch = useApiFetch()

const toast = useToast()
const { me, canManageCatalog } = useMe()
const { data: categories } = useCategories()
const { products } = useProducts()
// Para el picker de productos dentro de un kit necesitamos el catálogo
// completo (no paginado) — useProducts() puede venir paginado y truncar la
// lista, ver nota en memoria del proyecto sobre useAllProducts().
const { products: allProducts } = useAllProducts()

// ───────────────────────────────────────────────
//  TOGGLE: ¿producto, kit o muestra?
// ───────────────────────────────────────────────
type CreateMode = 'product' | 'kit' | 'sample'

// `?tipo=muestra|kit` abre directo en esa pestaña: es lo que usa el botón
// "Nueva muestra" de /productos/muestras, que si no caería en Producto.
const QUERY_MODES: Record<string, CreateMode> = { muestra: 'sample', kit: 'kit' }
const mode = ref<CreateMode>(
  QUERY_MODES[String(useRoute().query.tipo ?? '')] ?? 'product'
)

const MODE_META: Record<CreateMode, { title: string; description: string }> = {
  product: {
    title: 'Nuevo producto',
    description: 'Alta de un producto del catálogo.'
  },
  kit: {
    title: 'Nuevo kit',
    description: 'Alta de un kit de productos.'
  },
  sample: {
    title: 'Nueva muestra',
    description:
      'Una muestra es una segunda versión del mismo producto: comparte su inventario y siempre se entrega a precio $0.'
  }
}
const modeMeta = computed(() => MODE_META[mode.value])

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN'
})

// ───────────────────────────────────────────────
//  FORMULARIO: PRODUCTO (sin cambios respecto a la versión anterior)
// ───────────────────────────────────────────────
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

// ───────────────────────────────────────────────
//  FORMULARIO: KIT
// ───────────────────────────────────────────────
type KitItemRow = {
  productId: number | undefined
  quantity: number | undefined
  unitPrice: number | undefined
}

type KitFormState = {
  sku: string
  name: string
  isActive: boolean
  items: KitItemRow[]
}

function emptyKitItem(): KitItemRow {
  return { productId: undefined, quantity: undefined, unitPrice: undefined }
}

function emptyKitState(): KitFormState {
  return {
    sku: '',
    name: '',
    isActive: true,
    items: [emptyKitItem()]
  }
}

const kitState = reactive<KitFormState>(emptyKitState())
const kitSubmitting = ref(false)

const productPickerItems = computed(() =>
  allProducts.value
    .filter((p) => p.isActive)
    .map((p) => ({ label: `${p.sku} — ${p.name}`, value: p.id }))
)
const productMap = computed(() => new Map(allProducts.value.map((p) => [p.id, p])))

function addKitItem() {
  kitState.items.push(emptyKitItem())
}
function removeKitItem(index: number) {
  kitState.items.splice(index, 1)
  if (!kitState.items.length) kitState.items.push(emptyKitItem())
}

/** Precio efectivo de una línea: el override si existe, si no el del producto. */
function lineUnitPrice(row: KitItemRow): number | null {
  if (row.unitPrice != null) return row.unitPrice
  const product = row.productId ? productMap.value.get(row.productId) : undefined
  return product ? Number(product.price) : null
}

/** Suma de todas las líneas válidas — el precio de venta del kit completo. */
const kitEstimatedPrice = computed(() => {
  return kitState.items.reduce((sum, row) => {
    const unitPrice = lineUnitPrice(row)
    if (unitPrice == null || row.quantity == null) return sum
    return sum + unitPrice * row.quantity
  }, 0)
})

function validateKit(s: KitFormState): FormError[] {
  const errors: FormError[] = []
  if (!s.sku.trim()) {
    errors.push({ name: 'sku', message: 'El SKU es obligatorio.' })
  }
  if (!s.name.trim()) {
    errors.push({ name: 'name', message: 'El nombre es obligatorio.' })
  }

  const validRows = s.items.filter((r) => r.productId != null)
  if (!validRows.length) {
    errors.push({ name: 'items', message: 'Agrega al menos un producto al kit.' })
  }

  const seen = new Set<number>()
  s.items.forEach((row, i) => {
    if (row.productId == null) return
    if (seen.has(row.productId)) {
      errors.push({ name: `items.${i}.productId`, message: 'Este producto ya está en el kit.' })
    }
    seen.add(row.productId)

    if (row.quantity == null || row.quantity <= 0) {
      errors.push({ name: `items.${i}.quantity`, message: 'La cantidad debe ser mayor a 0.' })
    }
    if (row.unitPrice != null && row.unitPrice < 0) {
      errors.push({ name: `items.${i}.unitPrice`, message: 'No puede ser negativo.' })
    }
  })

  return errors
}

async function onSubmitKit(event: FormSubmitEvent<KitFormState>) {
  kitSubmitting.value = true
  const d = event.data

  const payload = {
    sku: d.sku.trim(),
    name: d.name.trim(),
    isActive: d.isActive,
    items: d.items
      .filter((r) => r.productId != null)
      .map((r) => ({
        productId: r.productId as number,
        quantity: r.quantity as number,
        unitPrice: r.unitPrice ?? null
      }))
  }

  try {
    const created = await apiFetch<{ id: number; sku: string; name: string }>('/api/kits', {
      method: 'POST',
      body: payload
    })
    toast.add({
      title: 'Kit creado',
      description: `${created.sku} — ${created.name}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    await navigateTo('/productos')
  } catch (e) {
    toast.add({
      title: 'No se pudo crear el kit',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    kitSubmitting.value = false
  }
}

function onResetKit() {
  Object.assign(kitState, emptyKitState())
}

// ───────────────────────────────────────────────
//  FORMULARIO: MUESTRA
// ───────────────────────────────────────────────
// Una muestra es una "segunda versión" del producto: MISMO inventario (lo
// descuenta 1:1 al entregarse) y precio fijo en $0. Por eso aquí no se captura
// unidad, categoría, color, precio ni costo: todo eso lo hereda del producto
// base y lo copia el servidor. Lo único propio es el SKU con el que se busca al
// vender y el nombre con el que aparece en el ticket.
//
// Las muestras NO se listan en /productos (no tienen existencias propias y
// ensuciarían el valor de inventario): se consultan en /productos/muestras.
// Aquí solo se dan de alta; el listado se lee de la misma fuente para saber qué
// productos ya tienen muestra y no ofrecerlos dos veces.
const { products: sellableProducts, refresh: refreshSellable } = useSellableProducts()

/** Muestras ya dadas de alta. */
const existingSamples = computed(() =>
  sellableProducts.value.filter((p) => p.sampleOfProductId != null)
)

/** Productos que ya tienen muestra: solo se permite una por producto. */
const basesWithSample = computed(
  () => new Set(existingSamples.value.map((s) => s.sampleOfProductId as number))
)

type SampleFormState = {
  baseProductId: number | undefined
  sku: string
  name: string
  isActive: boolean
}

function emptySampleState(): SampleFormState {
  return { baseProductId: undefined, sku: '', name: '', isActive: true }
}

const sampleState = reactive<SampleFormState>(emptySampleState())
const sampleSubmitting = ref(false)

const sampleBaseItems = computed(() =>
  allProducts.value
    .filter((p) => p.isActive && !basesWithSample.value.has(p.id))
    .map((p) => ({ label: `${p.sku} — ${p.name}`, value: p.id }))
)

const sampleBase = computed(() =>
  sampleState.baseProductId == null
    ? undefined
    : allProducts.value.find((p) => p.id === sampleState.baseProductId)
)

// Al elegir el producto base se proponen SKU y nombre derivados de él; ambos
// siguen siendo editables (el servidor deriva exactamente lo mismo si llegan
// vacíos).
watch(sampleBase, (base) => {
  if (!base) return
  sampleState.sku = `${base.sku}-M`
  sampleState.name = `${base.name} (MUESTRA)`
})

function validateSample(s: SampleFormState): FormError[] {
  const errors: FormError[] = []
  if (s.baseProductId == null) {
    errors.push({ name: 'baseProductId', message: 'Elige el producto del que será muestra.' })
  }
  const sku = s.sku.trim()
  if (!sku) {
    errors.push({ name: 'sku', message: 'El SKU es obligatorio.' })
  } else if (sellableProducts.value.some((p) => p.sku.toLowerCase() === sku.toLowerCase())) {
    errors.push({ name: 'sku', message: 'Ya existe un producto con este SKU.' })
  }
  if (!s.name.trim()) {
    errors.push({ name: 'name', message: 'El nombre es obligatorio.' })
  }
  return errors
}

async function onSubmitSample(event: FormSubmitEvent<SampleFormState>) {
  sampleSubmitting.value = true
  const d = event.data

  try {
    const created = await apiFetch<ApiProduct>('/api/products', {
      method: 'POST',
      body: {
        sampleOfProductId: d.baseProductId,
        sku: d.sku.trim(),
        name: d.name.trim(),
        isActive: d.isActive
      }
    })
    await refreshSellable()
    toast.add({
      title: 'Muestra creada',
      description: `${created.sku} — ${created.name}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    // Se queda en la pantalla a propósito: las muestras no aparecen en
    // /productos, así que mandarlo al catálogo daría la impresión de que no se
    // guardó nada. La tabla de abajo ya refleja el alta.
    Object.assign(sampleState, emptySampleState())
  } catch (e) {
    toast.add({
      title: 'No se pudo crear la muestra',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    sampleSubmitting.value = false
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
      <h1 class="text-2xl font-semibold">{{ modeMeta.title }}</h1>
      <p class="text-sm text-muted">
        {{ modeMeta.description }}
        Los campos con <span class="text-error">*</span> son obligatorios.
      </p>
    </header>

    <UAlert
      v-if="me && !canManageCatalog"
      color="warning"
      variant="soft"
      icon="i-lucide-lock"
      title="Acceso restringido"
      description="Solo un administrador (de empresa o de tienda) puede dar de alta productos, kits o muestras."
      class="mb-6"
    />
    <UAlert
      v-else-if="!me"
      color="info"
      variant="soft"
      icon="i-lucide-log-in"
      title="Inicia sesión"
      description="Necesitas iniciar sesión como administrador para crear productos, kits o muestras."
      class="mb-6"
    />

    <UButtonGroup class="mb-6">
      <UButton
        label="Producto"
        icon="i-lucide-package"
        :color="mode === 'product' ? 'primary' : 'neutral'"
        :variant="mode === 'product' ? 'solid' : 'outline'"
        @click="mode = 'product'"
      />
      <UButton
        label="Kit"
        icon="i-lucide-boxes"
        :color="mode === 'kit' ? 'primary' : 'neutral'"
        :variant="mode === 'kit' ? 'solid' : 'outline'"
        @click="mode = 'kit'"
      />
      <UButton
        label="Muestras"
        icon="i-lucide-palette"
        :color="mode === 'sample' ? 'primary' : 'neutral'"
        :variant="mode === 'sample' ? 'solid' : 'outline'"
        @click="mode = 'sample'"
      />
    </UButtonGroup>

    <!-- ─────────────────────────  PRODUCTO  ───────────────────────── -->
    <UForm
      v-if="mode === 'product'"
      :state="state"
      :validate="validate"
      :disabled="!canManageCatalog"
      class="space-y-6"
      @submit="onSubmit"
    >
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
          :disabled="!canManageCatalog"
        >
          Guardar producto
        </UButton>
      </div>
    </UForm>

    <!-- ───────────────────────────  KIT  ─────────────────────────── -->
    <UForm
      v-else-if="mode === 'kit'"
      :state="kitState"
      :validate="validateKit"
      :disabled="!canManageCatalog"
      class="space-y-6"
      @submit="onSubmitKit"
    >
      <UCard>
        <template #header>
          <h2 class="font-semibold">Identificación del kit</h2>
        </template>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="SKU" name="sku" required>
            <UInput v-model="kitState.sku" placeholder="KIT-PINTOR-01" class="w-full" />
          </UFormField>

          <UFormField label="Nombre" name="name" required>
            <UInput
              v-model="kitState.name"
              placeholder="Kit pintor básico"
              class="w-full"
            />
          </UFormField>
        </div>

        <USeparator class="my-4" />

        <UFormField name="isActive">
          <USwitch
            v-model="kitState.isActive"
            label="Kit activo"
            description="Los kits inactivos no se pueden vender."
          />
        </UFormField>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Productos del kit</h2>
            <span class="text-sm text-muted">
              Precio estimado: <strong>{{ currency.format(kitEstimatedPrice) }}</strong>
            </span>
          </div>
        </template>

        <UFormField name="items" :error="undefined">
          <div class="space-y-3">
            <div
              v-for="(row, index) in kitState.items"
              :key="index"
              class="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] items-start"
            >
              <UFormField :name="`items.${index}.productId`">
                <USelectMenu
                  v-model="row.productId"
                  :items="productPickerItems"
                  value-key="value"
                  searchable
                  placeholder="Selecciona un producto"
                  class="w-90"
                />
              </UFormField>

              <UFormField :name="`items.${index}.quantity`">
                <UInputNumber
                  v-model="row.quantity"
                  :min="0"
                  :step="1"
                  placeholder="Cant."
                  class="w-24"
                />
              </UFormField>

              <UFormField :name="`items.${index}.unitPrice`">
                <UInputNumber
                  v-model="row.unitPrice"
                  :min="0"
                  :step="0.01"
                  :format-options="{minimumFractionDigits:0, maximumFractionDigits:2}"
                  :placeholder="
                    row.productId
                      ? `${currency.format(Number(productMap.get(row.productId)?.price ?? 0))}`
                      : 'Precio'
                  "
                  class="w-36"
                />
              </UFormField>

              <UButton
                type="button"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                :disabled="kitState.items.length === 1 && !row.productId"
                @click="removeKitItem(index)"
              />
            </div>
          </div>
        </UFormField>

        <UButton
          type="button"
          icon="i-lucide-plus"
          variant="soft"
          color="neutral"
          class="mt-4"
          @click="addKitItem"
        >
          Agregar producto
        </UButton>

        <p class="text-xs text-muted mt-3">
          Deja el precio en blanco para usar el precio normal del producto. Llénalo
          solo si este producto debe venderse a otro precio dentro de este kit.
        </p>
      </UCard>

      <div class="flex flex-wrap justify-end gap-3">
        <UButton type="button" variant="ghost" color="neutral" @click="onResetKit">
          Limpiar
        </UButton>
        <UButton
          type="submit"
          icon="i-lucide-save"
          color="primary"
          :loading="kitSubmitting"
          :disabled="!canManageCatalog"
        >
          Guardar kit
        </UButton>
      </div>
    </UForm>

    <!-- ─────────────────────────  MUESTRAS  ─────────────────────────-->
    <template v-else>
      <UForm
        :state="sampleState"
        :validate="validateSample"
        :disabled="!canManageCatalog"
        class="space-y-6"
        @submit="onSubmitSample"
      >
        <UCard>
          <template #header>
            <h2 class="font-semibold">Producto base</h2>
          </template>

          <UFormField
            label="Producto del que será muestra"
            name="baseProductId"
            required
            help="Solo aparecen los productos activos que todavía no tienen muestra (se permite una por producto)."
          >
            <USelectMenu
              v-model="sampleState.baseProductId"
              :items="sampleBaseItems"
              value-key="value"
              searchable
              placeholder="Buscar producto por SKU o nombre…"
              class="w-full"
            />
          </UFormField>

          <!-- Todo esto se hereda: se muestra para que quede claro que la
               muestra no es un producto aparte con datos propios. -->
          <div
            v-if="sampleBase"
            class="mt-4 grid gap-3 rounded-lg bg-elevated/40 p-3 text-sm sm:grid-cols-4"
          >
            <div>
              <p class="text-xs text-muted">Unidad</p>
              <p class="font-medium">{{ UNIT_LABELS[sampleBase.unit] }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">Categoría</p>
              <p class="font-medium">{{ sampleBase.category ?? '—' }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">Existencia (compartida)</p>
              <p class="font-medium tabular-nums">{{ sampleBase.totalStock }}</p>
            </div>
            <div>
              <p class="text-xs text-muted">Precio de la muestra</p>
              <p class="font-medium">{{ currency.format(0) }}</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">Identificación de la muestra</h2>
          </template>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="SKU"
              name="sku"
              required
              help="Con este SKU se busca la muestra al vender."
            >
              <UInput
                v-model="sampleState.sku"
                :disabled="!sampleBase"
                placeholder="Elige primero el producto base"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Nombre" name="name" required>
              <UInput
                v-model="sampleState.name"
                :disabled="!sampleBase"
                placeholder="Elige primero el producto base"
                class="w-full"
              />
            </UFormField>
          </div>

          <USeparator class="my-4" />

          <UFormField name="isActive">
            <USwitch
              v-model="sampleState.isActive"
              label="Muestra activa"
              description="Las muestras inactivas no se pueden entregar. Desactivarla no afecta al producto base."
            />
          </UFormField>
        </UCard>

        <div class="flex flex-wrap justify-end gap-3">
          <UButton
            type="submit"
            icon="i-lucide-save"
            color="primary"
            :loading="sampleSubmitting"
            :disabled="!canManageCatalog"
          >
            Guardar muestra
          </UButton>
        </div>
      </UForm>

      <p class="mt-6 text-center text-sm text-muted">
        Las muestras registradas ({{ existingSamples.length }}) se consultan en
        <ULink to="/productos/muestras" class="underline">Muestras</ULink>.
      </p>
    </template>
  </UContainer>
</template>