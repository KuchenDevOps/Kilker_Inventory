<script setup lang="ts">
// Filtro de periodo (Todo/Día/Semana/Mes) + barra de búsqueda, compartido por los
// historiales de ventas y de entradas. Expone `from`/`to` (ISO) y `search` vía v-model.
// El periodo elige un rango CONCRETO: el día/semana/mes seleccionado (no relativo).
const search = defineModel<string>('search', { default: '' })
const from = defineModel<string | undefined>('from')
const to = defineModel<string | undefined>('to')

const props = withDefaults(defineProps<{ searchPlaceholder?: string }>(), {
  searchPlaceholder: 'Buscar…'
})

type Period = 'todo' | 'dia' | 'semana' | 'mes'
const period = ref<Period>('todo')
const anchor = ref(new Date().toISOString().slice(0, 10)) // yyyy-mm-dd (día/semana)
const month = ref(new Date().toISOString().slice(0, 7)) // yyyy-mm (mes)

const periods: { label: string; value: Period }[] = [
  { label: 'Todo', value: 'todo' },
  { label: 'Día', value: 'dia' },
  { label: 'Semana', value: 'semana' },
  { label: 'Mes', value: 'mes' }
]

// Recalcula el rango [from, to) cada vez que cambia el periodo o la fecha ancla.
watchEffect(() => {
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
  const d = new Date(`${anchor.value}T00:00:00`)
  if (period.value === 'dia') {
    const end = new Date(d)
    end.setDate(end.getDate() + 1)
    from.value = d.toISOString()
    to.value = end.toISOString()
    return
  }
  // semana: lunes–domingo que contiene la fecha ancla
  const dow = (d.getDay() + 6) % 7 // 0 = lunes
  const start = new Date(d)
  start.setDate(d.getDate() - dow)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  from.value = start.toISOString()
  to.value = end.toISOString()
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

    <UInput
      v-if="period === 'dia' || period === 'semana'"
      v-model="anchor"
      type="date"
      class="w-44"
    />
    <UInput v-else-if="period === 'mes'" v-model="month" type="month" class="w-44" />

    <UInput
      v-model="search"
      icon="i-lucide-search"
      :placeholder="props.searchPlaceholder"
      class="w-72 max-w-full"
    />
  </div>
</template>
