<script setup lang="ts">
import { PAYMENT_LABELS, UNIT_LABELS, type PaymentMethod } from '~/types/inventario'
import { ref } from 'vue'
// Forma mínima de la respuesta de /api/sales que consume la UI.
interface SaleResult {
  invoice: { folio: string; totalAmount: string }
}

useHead({ title: 'Nueva venta · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const { data: products } = useProducts()
const { data: stores } = useStores()
const apiFetch = useApiFetch()

const isEmployee = computed(() => me.value?.role === 'empleado')
const isAdmin = computed(() => me.value?.role === 'admin')
const canOperate = computed(() => isEmployee.value || isAdmin.value)

type Line = {
  productId: number | undefined
  quantity: number | undefined
  unitPrice: number | undefined
  discount: number | undefined

}

const storeId = ref<number | undefined>(undefined)
const note = ref('')
const paymentMethod = ref<PaymentMethod>('efectivo')
const paymentItems = (Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((v) => ({
  label: PAYMENT_LABELS[v],
  value: v
}))
const lines = reactive<Line[]>([{ productId: undefined, quantity: undefined, unitPrice: undefined, discount: undefined }])
const submitting = ref(false)

// El empleado vende solo en su tienda; se fija y bloquea. El admin elige.
watchEffect(() => {
  if (isEmployee.value && me.value?.storeId != null) {
    storeId.value = me.value.storeId
  }
})

const storeItems = computed(() =>
  stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)
const productItems = computed(() =>
  products.value.map((p) => ({ label: `${p.sku} — ${p.name}`, value: p.id }))
)

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN'
})

function productOf(id: number | undefined) {
  return id == null ? undefined : products.value.find((p) => p.id === id)
}

/** Existencia del producto de una línea en la tienda elegida. */
function stockInStore(productId: number | undefined) {
  // El catálogo solo trae stock total; mostramos el total como referencia.
  return productOf(productId)?.totalStock ?? 0
}

function effectivePrice(line: Line): number {
  if (line.unitPrice != null) return line.unitPrice
  const p = productOf(line.productId)
  return p ? Number(p.price) : 0
}

function lineTotal(line: Line): number {
  const base = effectivePrice(line) * (line.quantity ?? 0)
  return base * (1 - (line.discount ?? 0) / 100)
}

const grandTotal = computed(() => lines.reduce((sum, l) => sum + lineTotal(l), 0))

function addLine() {
  lines.push({ productId: undefined, quantity: undefined, unitPrice: undefined, discount: 0 })
  
}
function removeLine(i: number) {
  lines.splice(i, 1)
  if (lines.length === 0) addLine()
}

const validLines = computed(() =>
  lines.filter((l) => l.productId != null && (l.quantity ?? 0) > 0)
)
const canSubmit = computed(
  () => canOperate.value && storeId.value != null && validLines.value.length > 0
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const result = await apiFetch<SaleResult>('/api/sales', {
      method: 'POST',
      body: {
        storeId: storeId.value,
        note: note.value.trim() || undefined,
        paymentMethod: paymentMethod.value,
        items: validLines.value.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice ?? undefined
        }))
      }
    })
    await refreshNuxtData('products')
    toast.add({
      title: 'Venta registrada',
      description: `Folio ${result.invoice.folio} · ${currency.format(
        Number(result.invoice.totalAmount)
      )}`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    // Reiniciar líneas (la tienda del empleado se mantiene).
    note.value = ''
    lines.splice(0, lines.length, {
      productId: undefined,
      quantity: undefined,
      unitPrice: undefined,
      discount: undefined,
    })
  } catch (e) {
    toast.add({
      title: 'No se pudo registrar la venta',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}

const discounts = ref([
  {
    id: 1,
    name: '5',
  },
  {
    id: 2,
    name: '10',
  },
  {
    id: 3,
    name: '15',
  },
  {
    id: 4,
    name: '20',
  },
  {
    id: 5,
    name: '25',
  },
])

const selectedId = ref<number | null>(null)

const handleClick = (item: { id: number, name: string }) => {
  selectedId.value = item.id
  const numericValue = Number(item.name)/100
  console.log(`Clicked: ${item.name}`)
}
</script>

<template>
  <UContainer class="py-8 max-w-3xl space-y-6">
    <header>
      <h1 class="text-2xl font-semibold">Nueva venta</h1>
      <p class="text-sm text-muted">
        Registra una venta: genera la factura, sus líneas y los movimientos de
        salida que descuentan el inventario.
      </p>
    </header>

    <UAlert
      v-if="me && !canOperate"
      color="warning"
      variant="soft"
      icon="i-lucide-lock"
      title="Acceso restringido"
      description="Tu perfil no puede registrar ventas."
    />
    <UAlert
      v-else-if="!me"
      color="info"
      variant="soft"
      icon="i-lucide-log-in"
      title="Inicia sesión"
      description="Necesitas iniciar sesión para registrar ventas."
    />

    <UCard>
      <form class="space-y-5" @submit.prevent="onSubmit">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Sucursal"
            name="storeId"
            required
            :help="isEmployee ? 'Vendes en tu sucursal asignada.' : undefined"
          >
            <USelect
              v-model="storeId"
              :items="storeItems"
              :disabled="!canOperate || isEmployee"
              placeholder="Selecciona una sucursal"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Método de pago" name="paymentMethod" required>
            <USelect
              v-model="paymentMethod"
              :items="paymentItems"
              :disabled="!canOperate"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="Nota" name="note">
          <UInput
            v-model="note"
            :disabled="!canOperate"
            placeholder="Cliente, observaciones…"
            class="w-full"
          />
        </UFormField>

        <USeparator />

        <!-- Líneas de venta -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Productos</h2>
            <UButton
              type="button"
              size="xs"
              variant="soft"
              icon="i-lucide-plus"
              :disabled="!canOperate"
              @click="addLine"
            >
              Agregar línea
            </UButton>
          </div>

          <div
            v-for="(line, i) in lines"
            :key="i"
            class="grid items-end gap-3 sm:grid-cols-12 rounded-lg border border-default p-3"
          >
            <UFormField label="Producto" class="sm:col-span-5">
              <USelect
                v-model="line.productId"
                :items="productItems"
                :disabled="!canOperate"
                placeholder="Producto"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Cantidad" class="sm:col-span-2">
              <UInputNumber
                v-model="line.quantity"
                :min="0"
                :disabled="!canOperate"
                placeholder="1"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Precio unit."
              class="sm:col-span-3"
            >
              <UInputNumber
                v-model="line.unitPrice"
                :min="0"
                :step="0.01"
                :format-options="{minimumFractionDigits:0, maximumFractionDigits:2}"
                :disabled="!canOperate"
                :placeholder="productOf(line.productId)?.price ?? 'precio lista'"
                class="w-full"
              />
            </UFormField>

            <div class="sm:col-span-2 flex items-center justify-between gap-2">
              <span class="text-sm tabular-nums">{{
                currency.format(lineTotal(line))
              }}</span>
              <UButton
                type="button"
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                :disabled="!canOperate"
                @click="removeLine(i)"
              />
            </div>

            <p
              v-if="productOf(line.productId)"
              class="sm:col-span-12 text-xs text-muted"
            >
              {{ UNIT_LABELS[productOf(line.productId)!.unit] }} · existencia total:
              {{ stockInStore(line.productId) }}
            </p>

            <div class="sm:col-span-12 flex items-center gap-2 flex-wrap">
    <span class="text-xs text-muted">Descuento:</span>
    <UButton
      v-for="item in discounts"
      :key="item.id"
      size="xs"
      :color="line.discount === Number(item.name) ? 'primary' : 'neutral'"
      :variant="line.discount === Number(item.name) ? 'solid' : 'subtle'"
      @click="line.discount = line.discount === Number(item.name) ? 0 : Number(item.name)"
    >
      {{ item.name }}%
    </UButton>
    <span v-if="line.discount" class="text-xs text-muted ml-auto">
      −{{ line.discount }}% aplicado
    </span>
  </div>
      
          </div>
          
          
        </div>



        <USeparator />

        <div class="flex items-center justify-between">
          <span class="text-sm text-muted">Total</span>
          <span class="text-xl font-semibold tabular-nums">{{
            currency.format(grandTotal)
          }}</span>
        </div>

        <div class="flex justify-end">
          <UButton
            type="submit"
            icon="i-lucide-receipt-text"
            color="primary"
            :loading="submitting"
            :disabled="!canSubmit"
          >
            Registrar venta
          </UButton>
        </div>
      </form>

    
    </UCard>
  </UContainer>
</template>
