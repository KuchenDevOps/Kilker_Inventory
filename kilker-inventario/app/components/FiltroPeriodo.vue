<script setup lang="ts">
const search = defineModel<string>('search', { default: '' })
const from = defineModel<string | undefined>('from')
const to = defineModel<string | undefined>('to')

const props = withDefaults(defineProps<{ searchPlaceholder?: string }>(), {
  searchPlaceholder: 'Buscar…'
})

type Period = 'todo' | 'dia' | 'semana' | 'mes'
const period = ref<Period>('todo')
const anchor = ref(new Date().toISOString().slice(0, 10))
const month = ref(new Date().toISOString().slice(0, 7))

const weekStart = ref(new Date().toISOString().slice(0, 10))
const weekEnd = ref(new Date().toISOString().slice(0, 10))

// Si el usuario deja el rango invertido, lo corregimos automáticamente.
watch([weekStart, weekEnd], ([start, end]) => {
  if (start && end && start > end) {
    weekStart.value = end
    weekEnd.value = start
  }
})

const periods: { label: string; value: Period }[] = [
  { label: 'Todo', value: 'todo' },
  { label: 'Día', value: 'dia' },
  { label: 'Semana', value: 'semana' },
  { label: 'Mes', value: 'mes' }
]

// Función para actualizar los filtros
function updateFilters() {
  if (period.value === 'todo') {
    from.value = undefined
    to.value = undefined
    return
  }
  
  if (period.value === 'mes') {
    const start = new Date(`${month.value}-01T00:00:00`)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    from.value = start.toISOString()
    to.value = end.toISOString()
    return
  }
  
  if (period.value === 'dia') {
    const d = new Date(`${anchor.value}T00:00:00`)
    const end = new Date(d)
    end.setDate(end.getDate() + 1)
    from.value = d.toISOString()
    to.value = end.toISOString()
    return
  }
  
  // semana: rango libre [weekStart, weekEnd] inclusive
  const start = new Date(`${weekStart.value}T00:00:00`)
  const end = new Date(`${weekEnd.value}T00:00:00`)
  end.setDate(end.getDate() + 1)
  from.value = start.toISOString()
  to.value = end.toISOString()
}

// Observamos todos los cambios que afectan los filtros
watch(
  [period, anchor, month, weekStart, weekEnd],
  () => {
    updateFilters()
  },
  { immediate: true } // Se ejecuta inmediatamente al montar
)

/**
 * Sincroniza el botón cuando alguien LIMPIA el rango desde fuera.
 *
 * ⚠️ Sin esto, un "Limpiar filtros" de la página deja el rango vacío pero el
 * botón «Mes» (o «Día», o «Semana») marcado: la pantalla dice que hay un periodo
 * activo y el listado muestra todo. Peor todavía, volver a pulsar ese mismo
 * botón no repara nada, porque `period` ya vale eso y su watcher no dispara.
 *
 * Solo reacciona al caso "quedaron los dos en vacío": poner un rango desde fuera
 * no puede deducir qué botón le tocaría, así que ahí no se toca nada. No hay
 * bucle — con `period` ya en 'todo', `updateFilters` vuelve a dejar los dos en
 * `undefined` y este watcher no encuentra nada que cambiar.
 */
watch([from, to], ([f, t]) => {
  if (!f && !t && period.value !== 'todo') period.value = 'todo'
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <UButtonGroup>
      <UButton
        v-for="p in periods"
        :key="p.value"
        :label="p.label"
        :color="period === p.value ? 'primary' : 'neutral'"
        :variant="period === p.value ? 'solid' : 'outline'"
        @click="period = p.value"
      />
    </UButtonGroup>

    <UInput v-if="period === 'dia'" v-model="anchor" type="date" class="w-44" />

    <template v-else-if="period === 'semana'">
      <UInput v-model="weekStart" type="date" class="w-40" />
      <span class="text-sm text-muted">a</span>
      <UInput v-model="weekEnd" type="date" class="w-40" />
    </template>

    <UInput v-else-if="period === 'mes'" v-model="month" type="month" class="w-44" />

    <UInput
      v-model="search"
      icon="i-lucide-search"
      :placeholder="props.searchPlaceholder"
      class="w-72 max-w-full"
    />
  </div>
</template>