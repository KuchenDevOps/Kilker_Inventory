<script setup lang="ts">
import { PAYMENT_LABELS, UNIT_LABELS, type PaymentMethod } from '~/types/inventario'
import { CHANNEL_LABELS, type SaleChannel } from '~/types/inventario'

// Forma mínima de la respuesta de /api/sales que consume la UI.
interface SaleResult {
  invoice: { folio: string; totalAmount: string }
}

useHead({ title: 'Nueva venta · Inventario Kilker' })

const toast = useToast()
const { me, isStoreScoped } = useMe()
// Incluye MUESTRAS (useAllProducts las excluye). Una muestra se entrega a
// precio 0 y descuenta el inventario de su producto base: la existencia que
// trae ya es la del base.
const { products, refresh: refreshProducts } = useSellableProducts()
const { kits } = useKits()
const { data: stores } = useStores()
const { customers, pending, error, refresh } = useAllCustomers()
const apiFetch = useApiFetch()

const isAdmin = computed(() => me.value?.role === 'admin')
// Sucursal del usuario acotado (empleado o admin de tienda): debe existir y
// estar activa para poder vender. El corte es por `isStoreScoped`, no por
// `role === 'empleado'`: con el literal, un admin de tienda no entraba en
// ninguna rama de `canOperate` y la pantalla quedaba muerta para él.
const myStore = computed(() => stores.value.find((s) => s.id === me.value?.storeId))
const employeeNoStore = computed(() => isStoreScoped.value && !myStore.value)
const employeeStoreInactive = computed(
  () => isStoreScoped.value && !!myStore.value && !myStore.value.isActive
)
const canOperate = computed(
  () =>
    isAdmin.value ||
    (isStoreScoped.value && !employeeNoStore.value && !employeeStoreInactive.value)
)

type Line = {
  productId: number | undefined
  quantity: number | undefined
  unitPrice: number | undefined
}

const storeId = ref<number | undefined>(undefined)
const note = ref('')
const paymentMethod = ref<PaymentMethod>('efectivo')
const paymentItems = (Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((v) => ({
  label: PAYMENT_LABELS[v],
  value: v,
}))
// Fecha/hora de la venta. Vacío = ahora mismo (el backend usa defaultNow()).
const issuedAt = ref('')

// Fecha de la venta (solo día). Vacío = hoy (el backend usa defaultNow()).
const saleDate = ref('')

// Límite superior para el input: no permitir seleccionar una fecha futura.
const maxIssuedAt = computed(() => new Date().toISOString().slice(0, 16))
const lines = reactive<Line[]>([{ productId: undefined, quantity: undefined, unitPrice: undefined }])
const submitting = ref(false)
const discount = ref(0)

const discounts = [5, 10, 15, 20, 25]

// El empleado vende solo en su tienda; se fija y bloquea. El admin elige.
watchEffect(() => {
  if (isStoreScoped.value && me.value?.storeId != null) {
    storeId.value = me.value.storeId
  }
})

const storeItems = computed(() =>
  stores.value
    .filter((s) => s.isActive)
    .map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)
const productItems = computed(() =>
  products.value.map((p) => ({
    // La muestra se marca en el propio picker: es la única forma de
    // distinguirla del producto normal, que es justo para lo que existe.
    label:
      p.sampleOfProductId != null
        ? `${p.sku} — ${p.name} · muestra $0`
        : `${p.sku} — ${p.name}`,
    value: p.id
  }))
)

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
})

function productOf(id: number | undefined) {
  return id == null ? undefined : products.value.find((p) => p.id === id)
}

/** Existencia del producto de una línea en la tienda elegida. */
function stockInStore(productId: number | undefined) {
  // El catálogo solo trae stock total; mostramos el total como referencia.
  return productOf(productId)?.totalStock ?? 0
}

/** true si la línea entrega una muestra (precio fijo en 0). */
function isSampleLine(productId: number | undefined) {
  return productOf(productId)?.sampleOfProductId != null
}

function effectivePrice(line: Line): number {
  // El precio de una muestra es siempre 0 y el servidor lo fuerza; aquí se
  // refleja para que el total en pantalla coincida con el de la factura.
  if (isSampleLine(line.productId)) return 0
  if (line.unitPrice != null) return line.unitPrice
  const p = productOf(line.productId)
  return p ? Number(p.price) : 0
}

// Al cambiar una línea a muestra se limpia el precio capturado: dejarlo escrito
// (aunque no cuente) haría creer al vendedor que la muestra se está cobrando.
watch(
  () => lines.map((l) => l.productId),
  () => {
    for (const l of lines) if (isSampleLine(l.productId)) l.unitPrice = 0
  }
)

function lineTotal(line: Line): number {
  return effectivePrice(line) * (line.quantity ?? 0)
}

// ───────────────────────────────────────────────
//  KITS
// ───────────────────────────────────────────────
// Un kit se vende como una unidad, pero el backend lo explota en líneas de
// producto (el inventario es siempre por producto). Aquí solo se elige el kit
// y cuántos; los productos y precios se muestran de forma informativa.
type KitLine = {
  kitId: number | undefined
  quantity: number | undefined
}

const kitLines = reactive<KitLine[]>([])

const kitItems = computed(() =>
  kits.value
    .filter((k) => k.isActive)
    .map((k) => ({ label: `${k.sku} — ${k.name}`, value: k.id }))
)

function kitOf(id: number | undefined) {
  return id == null ? undefined : kits.value.find((k) => k.id === id)
}

/** Importe de una línea de kit: precio del kit × cuántos kits. */
function kitLineTotal(line: KitLine): number {
  const kit = kitOf(line.kitId)
  if (!kit) return 0
  return kit.totalPrice * (line.quantity ?? 0)
}

function addKitLine() {
  kitLines.push({ kitId: undefined, quantity: 1 })
}
function removeKitLine(i: number) {
  kitLines.splice(i, 1)
}

const validKitLines = computed(() =>
  kitLines.filter((l) => l.kitId != null && (l.quantity ?? 0) > 0)
)

const IVA_RATE = 0.16

// El subtotal incluye productos sueltos y kits; el descuento es un % sobre ese
// subtotal, así que aplica por igual a todo — incluidos los kits completos.
const subtotal = computed(
  () =>
    lines.reduce((sum, l) => sum + lineTotal(l), 0) +
    kitLines.reduce((sum, l) => sum + kitLineTotal(l), 0)
)
const grandTotal = computed(() => subtotal.value * (1 - discount.value / 100))
const discountTotal = computed(() => subtotal.value - grandTotal.value)

const saleIva = computed(() => grandTotal.value * IVA_RATE)

function addLine() {
  lines.push({ productId: undefined, quantity: undefined, unitPrice: undefined })
}
function removeLine(i: number) {
  lines.splice(i, 1)
  if (lines.length === 0) addLine()
}

const validLines = computed(() =>
  lines.filter((l) => l.productId != null && (l.quantity ?? 0) > 0)
)
const canSubmit = computed(
  () =>
    canOperate.value &&
    storeId.value != null &&
    (validLines.value.length > 0 || validKitLines.value.length > 0)
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    // Si se eligió una fecha, se combina con la hora actual para no perder
    // el orden cronológico real de captura dentro del mismo día.
    let issuedAt: string | undefined
    if (saleDate.value) {
      const now = new Date()
      // `YYYY-MM-DD` + 'T00:00:00' (sin sufijo Z) se interpreta en hora LOCAL,
      // igual que el `new Date(año, mes, día)` que había aquí antes.
      const combined = new Date(`${saleDate.value}T00:00:00`)
      combined.setHours(now.getHours(), now.getMinutes(), now.getSeconds())
      issuedAt = combined.toISOString()
    }

    const result = await apiFetch<SaleResult>('/api/sales', {
      method: 'POST',
      body: {
        storeId: storeId.value,
        customerId: customerId.value ?? undefined,
        channel: channel.value,
        note: note.value.trim() || undefined,
        paymentMethod: paymentMethod.value,
        discount: discount.value || undefined,
        issuedAt,
        items: validLines.value.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice ?? undefined,
        })),
        kits: validKitLines.value.map((l) => ({
          kitId: l.kitId,
          quantity: l.quantity,
        })),
      },
    })
    await refreshNuxtData('products')
    // `useSellableProducts` vive en useState, no en useAsyncData: refreshNuxtData
    // no lo toca y sin esto la existencia mostrada en el picker se queda vieja.
    await refreshProducts()
    toast.add({
      title: 'Venta registrada',
      description: `Folio ${result.invoice.folio} · ${currency.format(
        Number(result.invoice.totalAmount)
      )}`,
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
    note.value = ''
    discount.value = 0
    customerId.value = undefined
    saleDate.value = ''

    lines.splice(0, lines.length, {
      productId: undefined,
      quantity: undefined,
      unitPrice: undefined,
    })
    kitLines.splice(0, kitLines.length)
  } catch (e) {
    toast.add({
      title: 'No se pudo registrar la venta',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert',
    })
  } finally {
    submitting.value = false
  }
}

//customers
const customerId = ref<number | undefined>(undefined)
const channel = ref<SaleChannel>('mostrador')
const channelItems = (Object.keys(CHANNEL_LABELS) as SaleChannel[]).map((v) => ({
  label: CHANNEL_LABELS[v],
  value: v
}))
const customerItems = computed(() => [
  { label: 'Sin cliente (venta anónima)', value: undefined },
  ...customers.value.map((c) => ({ label: c.name, value: c.id }))
])

const creatingCustomer = ref(false)
const newCustomerName = ref('')
const newCustomerPhone = ref('')
const savingCustomer = ref(false)

async function quickCreateCustomer() {
  if (!newCustomerName.value.trim()) return
  savingCustomer.value = true
  try {
    const created = await apiFetch<{ id: number }>('/api/customers', {
      method: 'POST',
      body: { name: newCustomerName.value.trim(), phone: newCustomerPhone.value.trim() || undefined }
    })
    await refresh()
    customerId.value = created.id
    creatingCustomer.value = false
    newCustomerName.value = ''
    newCustomerPhone.value = ''
  } catch (e) {
    toast.add({ title: 'No se pudo crear el cliente', description: apiErrorMessage(e), color: 'error' })
  } finally {
    savingCustomer.value = false
  }
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
      v-if="!me"
      color="info"
      variant="soft"
      icon="i-lucide-log-in"
      title="Inicia sesión"
      description="Necesitas iniciar sesión para registrar ventas."
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
      description="Tu sucursal está desactivada. No puedes registrar ventas. Contacta a un administrador."
    />
    <UAlert
      v-else-if="!canOperate"
      color="warning"
      variant="soft"
      icon="i-lucide-lock"
      title="Acceso restringido"
      description="Tu perfil no puede registrar ventas."
    />

    <UCard>
      <form class="space-y-5" @submit.prevent="onSubmit">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Sucursal"
            name="storeId"
            required
            :help="isStoreScoped ? 'Vendes en tu sucursal asignada.' : undefined"
          >
            <USelect
              v-model="storeId"
              :items="storeItems"
              :disabled="!canOperate || isStoreScoped"
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

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Canal de venta" name="channel" required>
            <USelect v-model="channel" :items="channelItems" :disabled="!canOperate" class="w-full" />
          </UFormField>

          <UFormField
            label="Fecha de la venta"
            name="saleDate"
            help="Déjalo vacío para usar hoy."
          >
            <UInput
              v-model="saleDate"
              type="date"
              :disabled="!canOperate"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Cliente" name="customerId">
            <div class="flex gap-2">
              <USelectMenu
                v-model="customerId"
                :items="customerItems"
                value-key="value"
                :disabled="!canOperate"
                searchable
                placeholder="Buscar cliente por nombre…"
                class="w-full"
              />
              <UButton
                type="button"
                icon="i-lucide-user-plus"
                variant="soft"
                :disabled="!canOperate"
                @click="creatingCustomer = true"
              />
            </div>
          </UFormField>
        </div>

        <!-- Panel inline de alta rápida de cliente -->
        <UCard v-if="creatingCustomer" class="bg-elevated/30">
          <div class="flex flex-wrap items-end gap-3">
            <UFormField label="Nombre" class="flex-1 min-w-48">
              <UInput v-model="newCustomerName" placeholder="Nombre del cliente" class="w-full" />
            </UFormField>
            <UFormField label="Teléfono (opcional)" class="flex-1 min-w-40">
              <UInput v-model="newCustomerPhone" placeholder="55..." class="w-full" />
            </UFormField>
            <UButton :loading="savingCustomer" :disabled="!newCustomerName.trim()" @click="quickCreateCustomer">
              Guardar
            </UButton>
            <UButton variant="ghost" color="neutral" @click="creatingCustomer = false">Cancelar</UButton>
          </div>
        </UCard>

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
            <USelectMenu
              v-model="line.productId"
              :items="productItems"
              value-key="value"
              :disabled="!canOperate"
              searchable
              placeholder="Buscar producto por SKU o nombre…"
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

            <UFormField label="Precio unit." class="sm:col-span-3">
              <UInputNumber
                v-model="line.unitPrice"
                :min="0"
                :step="0.01"
                :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
                :disabled="!canOperate || isSampleLine(line.productId)"
                :placeholder="
                  isSampleLine(line.productId)
                    ? '0 (muestra)'
                    : productOf(line.productId)?.price ?? 'precio lista'
                "
                class="w-full"
              />
            </UFormField>

            <div class="sm:col-span-2 flex items-center justify-between gap-2">
              <span class="text-sm tabular-nums">{{ currency.format(lineTotal(line)) }}</span>
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
              <template v-if="isSampleLine(line.productId)">
                ·
                <span class="text-warning font-medium">
                  Muestra de {{ productOf(line.productId)!.baseSku }} — descuenta su
                  inventario y no se cobra
                </span>
              </template>
            </p>
          </div>
        </div>

        <USeparator />

        <!-- Kits -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-semibold">Kits</h2>
              <p class="text-xs text-muted">
                Al vender un kit se descuentan del inventario los productos que lo forman.
              </p>
            </div>
            <UButton
              type="button"
              size="xs"
              variant="soft"
              icon="i-lucide-plus"
              :disabled="!canOperate || !kitItems.length"
              @click="addKitLine"
            >
              Agregar kit
            </UButton>
          </div>

          <p v-if="!kitItems.length" class="text-sm text-muted">
            No hay kits activos disponibles.
          </p>

          <div
            v-for="(kitLine, i) in kitLines"
            :key="`kit-${i}`"
            class="rounded-lg border border-default p-3 space-y-3"
          >
            <div class="grid items-end gap-3 sm:grid-cols-12">
              <UFormField label="Kit" class="sm:col-span-7">
                <USelectMenu
                  v-model="kitLine.kitId"
                  :items="kitItems"
                  value-key="value"
                  :disabled="!canOperate"
                  searchable
                  placeholder="Buscar kit por SKU o nombre…"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="Cantidad" class="sm:col-span-3">
                <UInputNumber
                  v-model="kitLine.quantity"
                  :min="0"
                  :disabled="!canOperate"
                  placeholder="1"
                  class="w-full"
                />
              </UFormField>

              <div class="sm:col-span-2 flex items-center justify-between gap-2">
                <span class="text-sm tabular-nums">
                  {{ currency.format(kitLineTotal(kitLine)) }}
                </span>
                <UButton
                  type="button"
                  size="xs"
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  :disabled="!canOperate"
                  @click="removeKitLine(i)"
                />
              </div>
            </div>

            <!-- Productos que componen el kit (informativo) -->
            <div v-if="kitOf(kitLine.kitId)" class="rounded-md bg-elevated/40 p-3">
              <table class="w-full text-xs">
                <thead class="text-muted">
                  <tr class="text-left">
                    <th class="py-1 font-medium">Producto</th>
                    <th class="py-1 font-medium text-right">Cant. c/kit</th>
                    <th class="py-1 font-medium text-right">Total</th>
                    <th class="py-1 font-medium text-right">P. unit.</th>
                    <th class="py-1 font-medium text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="it in kitOf(kitLine.kitId)!.items" :key="it.id">
                    <td class="py-1">
                      <span class="font-mono">{{ it.sku ?? '—' }}</span>
                      · {{ it.name ?? `Producto ${it.productId}` }}
                    </td>
                    <td class="py-1 text-right tabular-nums">{{ it.quantity }}</td>
                    <td class="py-1 text-right tabular-nums">
                      {{ it.quantity * (kitLine.quantity ?? 0) }}
                    </td>
                    <td class="py-1 text-right tabular-nums">
                      {{ currency.format(it.unitPrice) }}
                    </td>
                    <td class="py-1 text-right tabular-nums">
                      {{ currency.format(it.lineTotal * (kitLine.quantity ?? 0)) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <USeparator />

        <!-- Descuento global -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm text-muted">Descuento:</span>
          <UButton
            v-for="d in discounts"
            :key="d"
            type="button"
            size="xs"
            :color="discount === d ? 'primary' : 'neutral'"
            :variant="discount === d ? 'solid' : 'subtle'"
            @click="discount = discount === d ? 0 : d"
          >
            {{ d }}%
          </UButton>
        </div>

        <USeparator />

        <!-- Total -->
        <div class="flex items-center justify-between">
          <span class="text-sm text-muted"></span>

          <div class="text-right">
            <div v-if="discount" class="flex justify-between gap-20">
              <span>Total Original</span>
              <p>{{ currency.format(subtotal) }}</p>
            </div>
            <div v-if="discount" class="flex justify-between gap-20">
              <span>Descuento</span>
              <p>-{{ currency.format(discountTotal) }}</p>
            </div>
            <div class="flex justify-between gap-20 text-xl font-semibold tabular-nums">
              <span v-if="!discount">Total</span>
              <span v-else="discount">Total Final</span>
              <p>{{ currency.format(grandTotal) }}</p>
            </div>
            <div v-if="grandTotal > 0" class="flex justify-between gap-20 text-xs text-muted mt-1">
              <span>IVA (16%) · informativo</span>
              <p>{{ currency.format(saleIva) }}</p>
            </div>
            <div class="flex justify-between gap-20 text-lg font-semibold tabular-nums">
                <span>Total con IVA: </span>
                <p>{{ currency.format(saleIva + grandTotal) }}</p>
            </div>

            
          </div>
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