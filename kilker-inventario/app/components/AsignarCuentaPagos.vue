<script setup lang="ts">
// ───────────────────────────────────────────────
//  ASIGNAR UNA CUENTA A TODOS LOS PAGOS DE UN DOCUMENTO
// ───────────────────────────────────────────────
// Va dentro de los tres modales de pagos (ventas, entradas, gastos). Sirve para
// dos cosas: rellenar los pagos capturados antes de que existiera el catálogo de
// cuentas, y corregir una cuenta mal elegida sin recapturar el abono.
//
// ⚠️ Solo admin, y el candado real es el del servidor. Esto no es captura: es
// reescribir a qué cuenta se atribuyó dinero ya registrado.

const props = defineProps<{
  /** Ruta del documento, sin `/payments`. Ej. `/api/expenses/12`. */
  endpoint: string
  /** Cuántos pagos del documento NO son en efectivo. Si es 0, no hay nada que asignar. */
  bankPaymentCount: number
  /** Cuántos de esos ya tienen cuenta; solo para redactar el botón. */
  assignedCount: number
}>()

const emit = defineEmits<{ done: [] }>()

const toast = useToast()
const apiFetch = useApiFetch()
const { me } = useMe()
const { accounts, pending: loadingAccounts } = useBankAccounts()

const isAdmin = computed(() => me.value?.role === 'admin')
const selected = ref<number | undefined>(undefined)
const applying = ref(false)

const items = computed(() =>
  accounts.value
    .filter((a) => a.isActive)
    .map((a) => ({
      label: a.cardLast4 ? `${a.bank} ···· ${a.cardLast4} · ${a.owner}` : `${a.bank} · ${a.owner}`,
      value: a.id
    }))
)

/** Faltan por asignar; es lo que hace útil el botón cuando ya hay algunos puestos. */
const missing = computed(() => Math.max(0, props.bankPaymentCount - props.assignedCount))

async function apply() {
  if (selected.value == null) return
  applying.value = true
  try {
    const res = await apiFetch<{ updated: number; skippedCash: number }>(
      `${props.endpoint}/payments`,
      { method: 'PATCH', body: { accountId: selected.value } }
    )
    toast.add({
      title: `Cuenta asignada a ${res.updated} pago(s)`,
      // Que el conteo no mienta: si el documento tenía pagos en efectivo, esos
      // se quedaron sin cuenta a propósito y hay que decirlo.
      description: res.skippedCash
        ? `Se omitieron ${res.skippedCash} pago(s) en efectivo, que no llevan cuenta.`
        : undefined,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    emit('done')
  } catch (e) {
    toast.add({
      title: 'No se pudo asignar la cuenta',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <div
    v-if="isAdmin && bankPaymentCount > 0"
    class="flex flex-wrap items-end gap-2 rounded-lg border border-default bg-elevated/40 p-3"
  >
    <UFormField
      :label="
        missing > 0
          ? `Asignar cuenta a los pagos (${missing} sin cuenta)`
          : 'Cambiar la cuenta de todos los pagos'
      "
      class="flex-1 min-w-56"
      :help="
        missing > 0
          ? 'Se aplica a todos los pagos bancarios de este documento.'
          : 'Reemplaza la cuenta en todos los pagos bancarios de este documento.'
      "
    >
      <USelectMenu
        v-model="selected"
        :items="items"
        value-key="value"
        :loading="loadingAccounts"
        placeholder="Elige una cuenta…"
        class="w-full"
      />
    </UFormField>
    <UButton
      icon="i-lucide-landmark"
      color="neutral"
      variant="subtle"
      :loading="applying"
      :disabled="selected == null"
      @click="apply"
    >
      Aplicar
    </UButton>
  </div>
</template>
