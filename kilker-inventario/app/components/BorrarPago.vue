<script setup lang="ts">
// ───────────────────────────────────────────────
//  BORRAR UN PAGO DEL HISTORIAL
// ───────────────────────────────────────────────
// Va en cada renglón del historial de pagos de los tres modales (ventas,
// entradas, gastos). Sirve para deshacer una errata de captura sin anular el
// documento entero: anularlo repone/saca inventario y borra TODOS los abonos.
//
// ⚠️ Solo admin, y el candado real es el del servidor (`v-if="isAdmin"` sólo
// esconde el botón). No es captura: es deshacer dinero ya asentado, misma
// categoría que anular una venta.
//
// El borrado revierte el movimiento de banco con una `anulacion` append-only, no
// borrando la fila original — por eso el toast dice si el dinero se devolvió o
// si el abono era anterior al libro de bancos y no había nada que devolver.

const props = defineProps<{
  /** Ruta del documento, sin `/payments`. Ej. `/api/sales/12`. */
  endpoint: string
  paymentId: number
  /** Importe del abono, sólo para redactar la confirmación. */
  amount: number
}>()

const emit = defineEmits<{ done: [] }>()

const toast = useToast()
const apiFetch = useApiFetch()
const { me } = useMe()

const isAdmin = computed(() => me.value?.role === 'admin')
const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

const confirming = ref(false)
const reason = ref('')
const deleting = ref(false)

function cancel() {
  confirming.value = false
  reason.value = ''
}

async function confirm() {
  deleting.value = true
  try {
    const res = await apiFetch<{ amount: string; cashFlowReversals: number }>(
      `${props.endpoint}/payments/${props.paymentId}`,
      { method: 'DELETE', body: { reason: reason.value.trim() || undefined } }
    )
    toast.add({
      title: `Pago de ${currency.format(Number(res.amount))} borrado`,
      description: res.cashFlowReversals
        ? 'Se revirtió el movimiento de la cuenta.'
        : 'Este abono no tenía movimiento de banco que revertir (es anterior al libro de cuentas).',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    cancel()
    emit('done')
  } catch (e) {
    toast.add({
      title: 'No se pudo borrar el pago',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div v-if="isAdmin" class="shrink-0">
    <UButton
      v-if="!confirming"
      icon="i-lucide-trash-2"
      color="error"
      variant="ghost"
      size="xs"
      title="Borrar este pago"
      @click="confirming = true"
    />
    <div v-else class="flex flex-wrap items-center justify-end gap-2">
      <UInput
        v-model="reason"
        placeholder="Motivo (opcional)"
        size="xs"
        class="w-40"
        @keyup.enter="confirm"
      />
      <UButton color="error" size="xs" :loading="deleting" @click="confirm">
        Borrar {{ currency.format(amount) }}
      </UButton>
      <UButton color="neutral" variant="ghost" size="xs" :disabled="deleting" @click="cancel">
        Cancelar
      </UButton>
    </div>
  </div>
</template>
