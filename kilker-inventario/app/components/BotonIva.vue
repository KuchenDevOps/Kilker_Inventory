<script setup lang="ts">
/**
 * Botón "Con IVA / Sin IVA" de los dashboards y los listados (/ventas, /gastos).
 *
 * ⚠️ **Solo cambia la vista.** No recarga nada ni toca la base: los importes que
 * manda el servidor son siempre los mismos y el cambio se pinta en el cliente.
 *
 * El componente **no calcula el IVA a propósito**: en los dos documentos el 16%
 * es dinero real y lo calcula Postgres en columnas generadas, así que la página
 * elige QUÉ columna pinta y nunca multiplica (ver `~/utils/iva.ts`):
 * - **Ventas:** `invoices.total_to_pay` = subtotal + IVA. Es lo que se le cobra
 *   al cliente.
 * - **Gastos:** `expenses.total_to_pay` = subtotal + IVA − retenciones. Es lo
 *   que se le paga al proveedor, y **no** es `subtotal × 1.16`: con retenciones
 *   esas dos cifras no coinciden.
 *
 * ⚠️ El modo "Sin IVA" no es una vista simplificada, es la CONTABLE: el subtotal
 * es el ingreso y el gasto del negocio, porque el IVA se entera al SAT y no es
 * ninguno de los dos. Por eso utilidad, márgenes y costo nunca lo llevan.
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
