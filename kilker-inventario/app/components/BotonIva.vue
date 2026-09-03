<script setup lang="ts">
/**
 * Botón "Con IVA / Sin IVA" de los dashboards y los listados (/ventas, /gastos).
 *
 * ⚠️ **Solo cambia la vista.** No recarga nada ni toca la base: los importes que
 * manda el servidor son siempre los mismos y el cambio se pinta en el cliente.
 *
 * El componente **no calcula el IVA a propósito**, porque "con IVA" no significa
 * lo mismo en todas las pantallas y un cálculo aquí dentro escondería esa
 * diferencia (ver `~/utils/iva.ts`):
 * - **Ventas:** el IVA es INFORMATIVO. No está en la BD; lo aplica la pantalla
 *   con `ivaOf` sobre `invoices.total_amount`, que es el cobrable real.
 * - **Gastos:** el IVA es parte de lo que de verdad se paga y lo calcula
 *   Postgres en columnas generadas (`iva`, `total_to_pay`), ya con las
 *   retenciones descontadas. Ahí "con IVA" es `totalToPay`, no `subtotal × 1.16`.
 *
 * Cada página decide entonces qué importe pinta en cada modo; esto solo unifica
 * cómo se ve el interruptor.
 */
const model = defineModel<boolean>({ required: true })

withDefaults(
  defineProps<{
    /** Tooltip. Por omisión describe el modo activo. */
    title?: string
  }>(),
  { title: undefined }
)
</script>

<template>
  <UButton
    :icon="model ? 'i-lucide-percent' : 'i-lucide-percent-circle'"
    :color="model ? 'primary' : 'neutral'"
    :variant="model ? 'solid' : 'subtle'"
    :title="title ?? (model ? 'Mostrando importes con IVA (16%)' : 'Mostrando importes sin IVA')"
    @click="model = !model"
  >
    {{ model ? 'Con IVA' : 'Sin IVA' }}
  </UButton>
</template>
