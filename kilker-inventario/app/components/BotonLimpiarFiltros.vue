<script setup lang="ts">
/**
 * Botón "Limpiar filtros" de los listados.
 *
 * ⚠️ Cada pantalla decide QUÉ limpia (su `@clear`), porque los filtros no son
 * los mismos en todas: periodo y búsqueda son comunes, pero sucursal, estado,
 * producto o tipo viven en cada página. El botón solo unifica cómo se ve y
 * cuándo se puede pulsar.
 *
 * Va deshabilitado —no escondido— cuando no hay nada que limpiar: así no salta
 * el layout al aparecer y la opción se ve aunque todavía no aplique.
 *
 * Importante para las páginas cuyos filtros viven en `useState` (ventas,
 * entradas, gastos, cortes, transferencias): ese estado es COMPARTIDO y
 * sobrevive a la navegación, así que sin este botón un filtro puesto ayer sigue
 * aplicado al volver mañana y parece que faltan datos.
 */
withDefaults(
  defineProps<{
    /** Hay al menos un filtro puesto. */
    active: boolean
    label?: string
  }>(),
  { label: 'Limpiar filtros' }
)

defineEmits<{ clear: [] }>()
</script>

<template>
  <UButton
    icon="i-lucide-filter-x"
    color="neutral"
    variant="subtle"
    :disabled="!active"
    :title="active ? 'Quitar todos los filtros' : 'No hay filtros aplicados'"
    @click="$emit('clear')"
  >
    {{ label }}
  </UButton>
</template>
