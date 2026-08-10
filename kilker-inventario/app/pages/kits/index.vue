<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

useHead({ title: 'Kits · Inventario Kilker' })

const { kits, pending, error, refresh } = useKits()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')


const apiFetch = useApiFetch()

const expandedId = ref<number | null>(null)

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN'
})

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return kits.value
  return kits.value.filter(
    (k) =>
      k.sku.toLowerCase().includes(q) ||
      k.name.toLowerCase().includes(q) ||
      // También busca dentro de los productos que componen el kit.
      k.items.some(
        (i) =>
          (i.sku ?? '').toLowerCase().includes(q) ||
          (i.name ?? '').toLowerCase().includes(q)
      )
  )
})

// Paginación client-side sobre el resultado ya filtrado (mismo patrón que /productos).
const page = ref(1)
const pageSize = ref(50)
const total = computed(() => filtered.value.length)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch(search, () => { page.value = 1 })


const { products: allProducts } = useAllProducts()

const productMap = computed(() => new Map(allProducts.value.map((p) => [p.id, p])))
const productPickerItems = computed(() =>
  allProducts.value.map((p) => ({
    label: `${p.sku} — ${p.name}`,
    value: p.id
  }))
)

interface EditKitItem {
  // undefined y no null: es lo que USelectMenu emite al limpiar la selección
  // (y lo que usa el alta en /productos/nuevo). Con null el v-model no tipa.
  productId: number | undefined
  quantity: number | null
  /** null = la línea hereda el precio de catálogo del producto. */
  unitPrice: number | null
}

interface EditKitState {
  id: number | null
  sku: string
  name: string
  isActive: boolean
  items: EditKitItem[]
}

function emptyEditState(): EditKitState {
  return {
    id: null,
    sku: '',
    name: '',
    isActive: true,
    items: [{ productId: undefined, quantity: 1, unitPrice: null }]
  }
}

const editOpen = ref(false)
const editState = ref<EditKitState>(emptyEditState())
const editSubmitting = ref(false)
const editErrorMsg = ref('')

function openEdit(kit: (typeof kits.value)[number]) {
  editState.value = {
    id: kit.id,
    sku: kit.sku,
    name: kit.name,
    isActive: kit.isActive,
    items: kit.items.length
      ? kit.items.map((it) => ({
          productId: it.productId,
          quantity: it.quantity,
          // Solo precargamos el override; si la línea usa precio de
          // catálogo (overrideUnitPrice null) dejamos el campo en blanco.
          unitPrice: it.overrideUnitPrice
        }))
      : [{ productId: undefined, quantity: 1, unitPrice: null }]
  }
  editErrorMsg.value = ''
  editOpen.value = true
}

function addEditItem() {
  editState.value.items.push({ productId: undefined, quantity: 1, unitPrice: null })
}

function removeEditItem(index: number) {
  if (editState.value.items.length === 1) {
    editState.value.items[0] = { productId: undefined, quantity: 1, unitPrice: null }
    return
  }
  editState.value.items.splice(index, 1)
}

const editEstimatedPrice = computed(() =>
  editState.value.items.reduce((sum, it) => {
    if (!it.productId || !it.quantity) return sum
    const list = Number(productMap.value.get(it.productId)?.price ?? 0)
    const unit = it.unitPrice ?? list
    return sum + unit * it.quantity
  }, 0)
)

function validateEdit(): string | null {
  if (!editState.value.sku.trim()) return 'El SKU es obligatorio'
  if (!editState.value.name.trim()) return 'El nombre es obligatorio'
  const validItems = editState.value.items.filter((it) => it.productId)
  if (!validItems.length) return 'El kit necesita al menos un producto'
  for (const it of validItems) {
    if (!it.quantity || it.quantity <= 0) return 'La cantidad de cada producto debe ser mayor a 0'
  }
  const ids = validItems.map((it) => it.productId)
  if (new Set(ids).size !== ids.length) {
    return 'No puedes repetir el mismo producto dos veces en el kit'
  }
  return null
}

async function submitEdit() {
  const err = validateEdit()
  if (err) {
    editErrorMsg.value = err
    return
  }
  if (!editState.value.id) return

  editSubmitting.value = true
  editErrorMsg.value = ''
  try {
    await apiFetch(`/api/kits/${editState.value.id}`, {
      method: 'PATCH',
      body: {
        sku: editState.value.sku.trim(),
        name: editState.value.name.trim(),
        isActive: editState.value.isActive,
        items: editState.value.items
          .filter((it) => it.productId)
          .map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice
          }))
      }
    })
    editOpen.value = false
    await refresh()
  } catch (e) {
    editErrorMsg.value = apiErrorMessage(e, 'No se pudo guardar el kit')
  } finally {
    editSubmitting.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Kits de venta</h1>
        <p class="text-sm text-muted">
          {{ total }} kits · productos que los componen y su precio
        </p>
      </div>
      <UButton
        v-if="isAdmin"
        to="/productos/nuevo"
        icon="i-lucide-plus"
        color="primary"
      >
        Nuevo kit
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los kits"
      :description="error"
    />

    <UInput
      v-model="search"
      icon="i-lucide-search"
      placeholder="Buscar por SKU o nombre del kit, o por producto que contiene…"
      class="w-full sm:max-w-md"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">SKU</th>
              <th class="px-4 py-3 font-medium">Kit</th>
              <th class="px-4 py-3 font-medium text-right">Productos</th>
              <th class="px-4 py-3 font-medium text-right">Precio del kit</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="6" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!paged.length">
              <td colspan="6" class="px-4 py-8 text-center text-muted">
                {{ search ? 'Sin resultados.' : 'Todavía no hay kits registrados.' }}
              </td>
            </tr>
            <template v-else>
              <template v-for="k in paged" :key="k.id">
                <tr class="hover:bg-elevated/50">
                  <td class="px-4 py-3 font-mono text-xs">{{ k.sku }}</td>
                  <td class="px-4 py-3 font-medium">{{ k.name }}</td>
                  <td class="px-4 py-3 text-right tabular-nums">{{ k.itemCount }}</td>

                  <td class="px-4 py-3 text-right tabular-nums">
                    <p class="font-medium">{{ currency.format(k.totalPrice) }}</p>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <UBadge
                      :label="k.isActive ? 'Activo' : 'Inactivo'"
                      :color="k.isActive ? 'success' : 'neutral'"
                      variant="subtle"
                    />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex justify-end gap-1">
                      <UButton
                        v-if="isAdmin"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-pencil"
                        @click="openEdit(k)"
                      />
                      <UButton
                        size="xs"
                        :color="expandedId === k.id ? 'primary' : 'neutral'"
                        variant="ghost"
                        :icon="expandedId === k.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                        @click="expandedId = expandedId === k.id ? null : k.id"
                      />
                    </div>
                  </td>
                </tr>

                <tr v-if="expandedId === k.id">
                  <td colspan="6" class="p-0 bg-elevated/40">
                    <table class="w-full text-sm">
                      <thead class="text-muted border-y border-default">
                        <tr class="text-left">
                          <th class="px-8 py-2 font-medium">SKU</th>
                          <th class="px-4 py-2 font-medium">Producto</th>
                          <th class="px-4 py-2 font-medium">Unidad</th>
                          <th class="px-4 py-2 font-medium text-right">Cantidad</th>
                          <th class="px-4 py-2 font-medium text-right">Precio de catálogo</th>
                          <th class="px-4 py-2 font-medium text-right">Precio en el kit</th>
                          <th class="px-4 py-2 font-medium text-right">Importe</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-default">
                        <tr v-if="!k.items.length">
                          <td colspan="7" class="px-8 py-3 text-muted">
                            Este kit no tiene productos.
                          </td>
                        </tr>
                        <tr v-for="it in k.items" :key="it.id">
                          <td class="px-8 py-3 font-mono text-xs">{{ it.sku ?? '—' }}</td>
                          <td class="px-4 py-3">
                            {{ it.name ?? `Producto ${it.productId}` }}
                            <UBadge
                              v-if="!it.productIsActive"
                              label="Inactivo"
                              color="warning"
                              variant="subtle"
                              size="xs"
                              class="ml-2"
                            />
                          </td>
                          <td class="px-4 py-3 text-muted">
                            {{ it.unit ? UNIT_LABELS[it.unit] : '—' }}
                          </td>
                          <td class="px-4 py-3 text-right tabular-nums">{{ it.quantity }}</td>
                          <td class="px-4 py-3 text-right tabular-nums text-muted">
                            {{ currency.format(it.listUnitPrice) }}
                          </td>
                          <td class="px-4 py-3 text-right tabular-nums">
                            {{ currency.format(it.unitPrice) }}
                          </td>
                          <td class="px-4 py-3 text-right tabular-nums">
                            {{ currency.format(it.lineTotal) }}
                          </td>
                        </tr>
                      </tbody>
                      <tfoot class="border-t border-default">
                        <tr>
                          <td colspan="6" class="px-4 py-3 text-right font-medium">
                            Total del kit
                          </td>
                          <td class="px-4 py-3 text-right tabular-nums font-semibold">
                            {{ currency.format(k.totalPrice) }}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </div>
    </UCard>

    <div class="flex flex-col items-center gap-2">
      <p class="text-xs text-muted">Mostrando {{ paged.length }} de {{ total }} kits</p>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>

    <!-- ─────────────── Modal de edición ─────────────── -->
    <UModal v-model:open="editOpen" title="Editar kit">
      <template #body>
        <div class="space-y-6">
          <UAlert
            v-if="editErrorMsg"
            color="error"
            variant="soft"
            icon="i-lucide-triangle-alert"
            :description="editErrorMsg"
          />

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="SKU" required>
              <UInput v-model="editState.sku" class="w-full" />
            </UFormField>
            <UFormField label="Nombre" required>
              <UInput v-model="editState.name" class="w-full" />
            </UFormField>
          </div>

          <UFormField>
            <USwitch
              v-model="editState.isActive"
              label="Kit activo"
              description="Los kits inactivos no se pueden vender."
            />
          </UFormField>

          <USeparator />

          <div class="flex items-center justify-between">
            <h3 class="font-medium">Productos del kit</h3>
            <span class="text-sm text-muted">
              Precio estimado: <strong>{{ currency.format(editEstimatedPrice) }}</strong>
            </span>
          </div>

          <div class="space-y-3">
            <div
              v-for="(row, index) in editState.items"
              :key="index"
              class="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] items-start"
            >
              <USelectMenu
                v-model="row.productId"
                :items="productPickerItems"
                value-key="value"
                searchable
                placeholder="Selecciona un producto"
                class="w-full"
              />
              <UInputNumber
                v-model="row.quantity"
                :min="0"
                :step="1"
                placeholder="Cant."
                class="w-24"
              />
              <UInputNumber
                v-model="row.unitPrice"
                :min="0"
                :step="0.01"
                :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
                :placeholder="
                  row.productId
                    ? currency.format(Number(productMap.get(row.productId)?.price ?? 0))
                    : 'Precio'
                "
                class="w-36"
              />
              <UButton
                type="button"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                :disabled="editState.items.length === 1 && !row.productId"
                @click="removeEditItem(index)"
              />
            </div>
          </div>

          <UButton
            type="button"
            icon="i-lucide-plus"
            variant="soft"
            color="neutral"
            @click="addEditItem"
          >
            Agregar producto
          </UButton>

          <p class="text-xs text-muted">
            Deja el precio en blanco para usar el precio normal del producto. Llénalo
            solo si este producto debe venderse a otro precio dentro de este kit.
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-3 w-full">
          <UButton variant="ghost" color="neutral" @click="editOpen = false">
            Cancelar
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-save"
            :loading="editSubmitting"
            @click="submitEdit"
          >
            Guardar cambios
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>