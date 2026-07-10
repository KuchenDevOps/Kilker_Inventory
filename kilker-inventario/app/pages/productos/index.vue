<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

useHead({ title: 'Catálogo · Inventario Kilker' })

const { data: products, pending, error } = useProducts()
const { data: stores } = useStores();
const storeMap = computed(() => new Map(stores.value.map((s) => [s.id, s])))
const expandedId = ref<number | null>(null)
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const toast = useToast()
const apiFetch = useApiFetch()
const confirmingDeleteId = ref<number | null>(null)
const deleting = ref(false)

async function deleteProduct(id: number) {
  deleting.value = true
  try {
    await apiFetch(`/api/products/${id}`, { method: 'DELETE' })
    await refreshNuxtData('products')
    toast.add({
      title: 'Producto borrado',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    confirmingDeleteId.value = null
  } catch (e) {
    toast.add({
      title: 'No se pudo borrar el producto',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    deleting.value = false
  }
}

const currency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN'
})

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return products.value
  return products.value.filter(
    (p) =>
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (p.category ?? '').toLowerCase().includes(q) ||
      (p.color ?? '').toLowerCase().includes(q)
  )
})


</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Catálogo</h1>
        <p class="text-sm text-muted">
          {{ products.length }} productos · existencias
        </p>
      </div>
      <UButton
        v-if="isAdmin"
        to="/productos/nuevo"
        icon="i-lucide-plus"
        color="primary"
      >
        Nuevo producto
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar los productos"
      :description="error.message"
    />

    <UInput
      v-model="search"
      icon="i-lucide-search"
      placeholder="Buscar por SKU, nombre, categoría o color…"
      class="w-full sm:max-w-sm"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">SKU</th>
              <th class="px-4 py-3 font-medium">Producto</th>
              <th class="px-4 py-3 font-medium">Categoría</th>
              <th class="px-4 py-3 font-medium">Unidad</th>
              <th class="px-4 py-3 font-medium text-right">Precio</th>
              <th class="px-4 py-3 font-medium text-right">Existencia</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="8" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!filtered.length">
              <td colspan="8" class="px-4 py-8 text-center text-muted">
                Sin resultados.
              </td>
            </tr>
            <template v-else>
              <template v-for="p in filtered" :key="p.id">
                <tr class="hover:bg-elevated/50">
                  <td class="px-4 py-3 font-mono text-xs">{{ p.sku }}</td>
                  <td class="px-4 py-3">
                    <p class="font-medium">{{ p.name }}</p>
                    <p v-if="p.color" class="text-xs text-muted">{{ p.color }}</p>
                  </td>
                  <td class="px-4 py-3 text-muted">{{ p.category ?? '—' }}</td>
                  <td class="px-4 py-3 text-muted">{{ UNIT_LABELS[p.unit] }}</td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {{ currency.format(Number(p.price)) }}
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">{{ p.totalStock }}</td>
                  <td class="px-4 py-3 text-center">
                    <UBadge
                      :label="p.isActive ? 'Activo' : 'Inactivo'"
                      :color="p.isActive ? 'success' : 'neutral'"
                      variant="subtle"
                    />
                  </td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex items-center justify-end gap-1">
                      <template v-if="confirmingDeleteId === p.id">
                        <span class="text-xs text-muted mr-1">¿Borrar?</span>
                        <UButton
                          size="xs"
                          color="error"
                          variant="soft"
                          icon="i-lucide-check"
                          :loading="deleting"
                          @click="deleteProduct(p.id)"
                        />
                        <UButton
                          size="xs"
                          color="neutral"
                          variant="ghost"
                          icon="i-lucide-x"
                          :disabled="deleting"
                          @click="confirmingDeleteId = null"
                        />
                      </template>
                      <template v-else>
                        <template v-if="isAdmin">
                          <UButton
                            :to="`/productos/${p.id}/editar`"
                            size="xs"
                            color="neutral"
                            variant="ghost"
                            icon="i-lucide-pencil"
                          />
                          <UButton
                            size="xs"
                            color="error"
                            variant="ghost"
                            icon="i-lucide-trash-2"
                            @click="confirmingDeleteId = p.id"
                          />
                        </template>
                        <UButton
                          size="xs"
                          :color="expandedId === p.id ? 'primary' : 'neutral'"
                          variant="ghost"
                          icon="i-lucide-store"
                          @click="expandedId = expandedId === p.id ? null : p.id"
                        />
                      </template>
                    </div>
                  </td>
                </tr>
                <tr v-if="expandedId === p.id">
                  <td colspan="8" class="p-0 bg-elevated/40">
                    <table class="w-full text-sm">
                      <thead class="text-muted border-y border-default">
                        <tr class="text-left">
                          <th class="px-8 py-2 font-medium">Código</th>
                          <th class="px-4 py-2 font-medium">Sucursal</th>
                          <th class="px-4 py-2 font-medium text-right">Existencia</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-default">
                        <tr v-if="!p.byStore.length">
                          <td colspan="3" class="px-8 py-3 text-muted">Sin existencias registradas.</td>
                        </tr>
                        <tr v-for="b in p.byStore" :key="b.storeId">
                          <td class="px-8 py-3 font-mono text-xs">{{ storeMap.get(b.storeId)?.code ?? '?' }}</td>
                          <td class="px-4 py-3 text-muted">{{ storeMap.get(b.storeId)?.name ?? `Sucursal ${b.storeId}` }}</td>
                          <td class="px-4 py-3 text-right tabular-nums">{{ b.quantity }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
                
              </template>
            </template>
          </tbody>
        </table>
      </div>
    
    </UCard>
  </UContainer>
</template>
