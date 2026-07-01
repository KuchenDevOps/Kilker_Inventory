<script setup lang="ts">
useHead({ title: 'Historial de entradas · Inventario Kilker' })

const { me } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { movements, pending, error, storeId, from, to, search, refresh } = useMovements()
const { data: stores } = useStores()

// Estado compartido: refrescamos al entrar para no mostrar datos viejos.
onMounted(() => {
  refresh()
})

const storeItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])
// El filtro de tienda usa 0 = todas; lo mapeamos al ref (undefined = todas).
const storeFilter = computed({
  get: () => storeId.value ?? 0,
  set: (v: number) => {
    storeId.value = v || undefined
  }
})

const qtyFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
const dayFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })
function fmtDate(s: string | null) {
  return s ? dateFmt.format(new Date(s)) : '—'
}
function fmtDay(s: string | null) {
  return s ? dayFmt.format(new Date(`${s}T00:00:00`)) : '—'
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Historial de entradas</h1>
        <p class="text-sm text-muted">
          {{ movements.length }} entrada(s)
          <template v-if="!isAdmin"> · tu sucursal</template>
        </p>
      </div>
      <UButton to="/movimientos/entrada" icon="i-lucide-plus" color="primary">
        Nueva entrada
      </UButton>
    </header>

    <div class="space-y-3">
      <FiltroPeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        search-placeholder="Buscar producto, SKU, factura, sucursal…"
      />
      <USelect v-if="isAdmin" v-model="storeFilter" :items="storeItems" class="w-60" />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudo cargar el historial"
      :description="error"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium">Producto</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium text-right">Cantidad</th>
              <th class="px-4 py-3 font-medium">Factura prov.</th>
              <th class="px-4 py-3 font-medium">Fecha factura</th>
              <th class="px-4 py-3 font-medium">Registró</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td :colspan="7" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!movements.length">
              <td :colspan="7" class="px-4 py-8 text-center text-muted">
                Sin entradas para el filtro actual.
              </td>
            </tr>
            <tr v-for="m in movements" v-else :key="m.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(m.createdAt) }}</td>
              <td class="px-4 py-3">
                <div class="font-medium">{{ m.productName ?? '—' }}</div>
                <div class="font-mono text-xs text-muted">{{ m.productSku ?? '—' }}</div>
              </td>
              <td class="px-4 py-3 text-muted">{{ m.storeCode ?? '—' }}</td>
              <td class="px-4 py-3 text-right tabular-nums">
                {{ qtyFmt.format(Number(m.quantity)) }}
                <span class="text-muted">{{ m.unit ?? '' }}</span>
              </td>
              <td class="px-4 py-3 text-muted">{{ m.supplierInvoiceNumber ?? '—' }}</td>
              <td class="px-4 py-3 text-muted whitespace-nowrap">
                {{ fmtDay(m.supplierInvoiceDate) }}
              </td>
              <td class="px-4 py-3 text-muted">{{ m.createdByName ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </UContainer>
</template>
