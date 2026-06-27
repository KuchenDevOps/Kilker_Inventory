<script setup lang="ts">
import { UNIT_LABELS } from '~/types/inventario'

useHead({ title: 'Catálogo · Inventario Kilker' })

const { data: products, pending, error } = useProducts()
const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

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
          {{ products.length }} productos · existencias sumando todas las sucursales
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
              <th v-if="isAdmin" class="px-4 py-3 font-medium text-right">Editar</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td :colspan="isAdmin ? 8 : 7" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!filtered.length">
              <td :colspan="isAdmin ? 8 : 7" class="px-4 py-8 text-center text-muted">
                Sin resultados.
              </td>
            </tr>
            <tr
              v-for="p in filtered"
              v-else
              :key="p.id"
              class="hover:bg-elevated/50"
            >
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
              <td v-if="isAdmin" class="px-4 py-3 text-right">
                <UButton
                  :to="`/productos/${p.id}/editar`"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-pencil"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </UContainer>
</template>
