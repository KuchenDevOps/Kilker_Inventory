<script setup lang="ts">
/**
 * Tarjeta de sumatoria para los listados (/ventas, /movimientos, /gastos).
 *
 * ⚠️ El importe SIEMPRE viene del servidor, calculado sobre todo el filtro. No
 * sumes aquí lo que se ve en pantalla: los tres listados están paginados, así
 * que sumar las filas visibles daría el total de la página y cambiaría al pasar
 * a la siguiente — que es justo lo que la tarjeta no debe hacer.
 */
const props = withDefaults(
  defineProps<{
    label: string
    amount: number
    /** Línea chica bajo el importe: conteo, base de cálculo, exclusiones. */
    hint?: string | null
    icon?: string
    loading?: boolean
    tone?: 'neutral' | 'success' | 'error'
  }>(),
  { hint: null, icon: 'i-lucide-coins', loading: false, tone: 'neutral' }
)

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

const toneClass = computed(
  () =>
    ({
      neutral: '',
      success: 'text-success',
      error: 'text-error'
    })[props.tone]
)
</script>

<template>
  <UCard :ui="{ body: 'p-3 sm:p-4' }">
    <div class="flex items-start gap-3">
      <UIcon :name="icon" class="size-4 mt-0.5 text-primary shrink-0" />
      <div class="min-w-0">
        <p class="text-xs text-muted">{{ label }}</p>
        <p v-if="loading" class="mt-0.5 text-lg font-semibold text-muted">…</p>
        <p v-else class="mt-0.5 text-lg font-semibold tabular-nums" :class="toneClass">
          {{ currency.format(amount) }}
        </p>
        <p v-if="hint" class="mt-0.5 text-xs text-muted">{{ hint }}</p>
      </div>
    </div>
  </UCard>
</template>
