<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

useHead({ title: 'Nueva transferencia · Inventario Kilker' })

const toast = useToast()
const { me } = useMe()
const { data: products } = useProducts()
const { data: stores } = useStores()
const apiFetch = useApiFetch()

const isAdmin = computed(() => me.value?.role === 'admin')
const myStore = computed(() => stores.value.find((s) => s.id === me.value?.storeId))
const canOperate = computed(() => isAdmin.value || !!myStore.value)

const fromStoreId = ref<number | undefined>(undefined)
const toStoreId = ref<number | undefined>(undefined)
const note = ref('')
const submitting = ref(false)

watchEffect(() => {
  if (!isAdmin.value && me.value?.storeId != null) {
    fromStoreId.value = me.value.storeId
  }
})

type Line = { productId: number | undefined; quantity: number | undefined }
const lines = reactive<Line[]>([{ productId: undefined, quantity: undefined }])

function addLine() {
  lines.push({ productId: undefined, quantity: undefined })
}
function removeLine(i: number) {
  lines.splice(i, 1)
  if (lines.length === 0) addLine()
}

const storeItems = computed(() =>
  stores.value.filter((s) => s.isActive).map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
)
const toStoreItems = computed(() => storeItems.value.filter((s) => s.value !== fromStoreId.value))
const productItems = computed(() => products.value.map((p) => ({ label: `${p.sku} — ${p.name}`, value: p.id })))

function stockInFromStore(productId: number | undefined) {
  if (productId == null || fromStoreId.value == null) return null
  const p = products.value.find((x) => x.id === productId)
  return p?.byStore.find((b) => b.storeId === fromStoreId.value)?.quantity ?? 0
}

const saleDate = ref('')

const validLines = computed(() => lines.filter((l) => l.productId != null && (l.quantity ?? 0) > 0))
const canSubmit = computed(
  () =>
    canOperate.value &&
    fromStoreId.value != null &&
    toStoreId.value != null &&
    fromStoreId.value !== toStoreId.value &&
    validLines.value.length > 0
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
        let issuedAt: string | undefined

       if (saleDate.value) {
      const now = new Date()
      const [year, month, day] = saleDate.value.split('-').map(Number)
      const combined = new Date(
        year,
        month - 1,
        day,
        now.getHours(),
        now.getMinutes(),
        now.getSeconds()
      )
      issuedAt = combined.toISOString()
    }
    await apiFetch('/api/transfers', {
      method: 'POST',
      body: {
        fromStoreId: fromStoreId.value,
        toStoreId: toStoreId.value,
        note: note.value.trim() || undefined,
        items: validLines.value.map((l) => ({ productId: l.productId, quantity: l.quantity }))
      }
    })
    await refreshNuxtData('products')
    toast.add({ title: 'Transferencia creada', description: 'Queda en tránsito hasta que la reciban.', color: 'success', icon: 'i-lucide-circle-check' })
    await navigateTo('/transferencias')
  } catch (e) {
    toast.add({ title: 'No se pudo crear la transferencia', description: apiErrorMessage(e), color: 'error', icon: 'i-lucide-triangle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 max-w-2xl space-y-6">
    <header>
      <h1 class="text-2xl font-semibold">Nueva transferencia</h1>
      <p class="text-sm text-muted">
        Mueve productos entre sucursales. Descuenta el inventario del origen de inmediato;
        el destino confirma la recepción por separado.
      </p>
    </header>

    <UCard>
      <form class="space-y-5" @submit.prevent="onSubmit">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Sucursal origen" required>
            <USelect
              v-model="fromStoreId"
              :items="storeItems"
              :disabled="!isAdmin"
              placeholder="Selecciona origen"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Sucursal destino" required>
            <USelect v-model="toStoreId" :items="toStoreItems" placeholder="Selecciona destino" class="w-full" />
          </UFormField>
        </div>
        <div>
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
        </div>

        <UFormField label="Nota">
          <UInput v-model="note" placeholder="Motivo del traslado…" class="w-full" />
        </UFormField>

        <USeparator />

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Productos</h2>
            <UButton type="button" size="xs" variant="soft" icon="i-lucide-plus" @click="addLine">
              Agregar línea
            </UButton>
          </div>

          <div
            v-for="(line, i) in lines"
            :key="i"
            class="grid items-end gap-3 sm:grid-cols-12 rounded-lg border border-default p-3"
          >
            <UFormField label="Producto" class="sm:col-span-7">
              <USelectMenu
                v-model="line.productId"
                :items="productItems"
                value-key="value"
                searchable
                placeholder="Buscar producto…"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Cantidad" class="sm:col-span-3">
              <UInputNumber v-model="line.quantity" :min="0" placeholder="1" class="w-full" />
            </UFormField>
            <div class="sm:col-span-2 flex justify-end">
              <UButton
                type="button"
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                @click="removeLine(i)"
              />
            </div>
            <p v-if="line.productId != null" class="sm:col-span-12 text-xs text-muted">
              Disponible en origen: {{ stockInFromStore(line.productId) ?? '—' }}
            </p>
          </div>
        </div>

        <div class="flex justify-end">
          <UButton
            type="submit"
            icon="i-lucide-arrow-left-right"
            color="primary"
            :loading="submitting"
            :disabled="!canSubmit"
          >
            Crear transferencia
          </UButton>
        </div>
      </form>
    </UCard>
  </UContainer>
</template>