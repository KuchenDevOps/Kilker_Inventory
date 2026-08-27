<script setup lang="ts">
import type { PaymentMethod } from '~/types/inventario'

// ───────────────────────────────────────────────
//  SELECTOR DE CUENTA BANCARIA PARA UN PAGO
// ───────────────────────────────────────────────
// Lo montan los tres modales de pago: ventas, entradas y gastos. La regla
// método ↔ cuenta vive en `app/utils/paymentAccount.ts` y su espejo real en
// `resolvePaymentAccount` (servidor).
//
// ⚠️ Solo se ofrecen cuentas ACTIVAS. Una cuenta desactivada conserva sus pagos
// históricos —la baja es suave— pero no debe admitir pagos nuevos; si aparece
// aquí, desactivarla no sirve de nada.

const props = defineProps<{
  /** Método elegido en el formulario de pago. */
  method: PaymentMethod
}>()

const accountId = defineModel<number | null>({ required: true })

const { accounts, pending } = useBankAccounts()

const needsAccount = computed(() => requiresBankAccount(props.method))

const activeAccounts = computed(() => accounts.value.filter((a) => a.isActive))

const items = computed(() =>
  activeAccounts.value.map((a) => ({
    label: a.cardLast4 ? `${a.bank} ···· ${a.cardLast4} · ${a.owner}` : `${a.bank} · ${a.owner}`,
    value: a.id
  }))
)

/**
 * Al pasar a efectivo se limpia la cuenta.
 *
 * ⚠️ No es cosmético: sin esto, elegir "transferencia", escoger cuenta y luego
 * cambiar a "efectivo" mandaría el `accountId` viejo, y el servidor rechaza el
 * pago con "un pago en efectivo no lleva cuenta bancaria" sin que se vea por qué.
 */
watch(
  () => props.method,
  () => {
    if (!needsAccount.value) accountId.value = null
  },
  { immediate: true }
)

/** Hay que elegir cuenta pero no existe ninguna activa: el pago no va a pasar. */
const noAccounts = computed(
  () => needsAccount.value && !pending.value && activeAccounts.value.length === 0
)

/**
 * Puente null ↔ undefined: `USelectMenu` usa `undefined` para "nada elegido",
 * pero hacia afuera el valor tiene que ser `null`, que es lo que la API entiende
 * como efectivo. Mandar `undefined` en el body lo omitiría del JSON, y entonces
 * el servidor no distinguiría "efectivo" de "se me olvidó la cuenta".
 */
const selected = computed<number | undefined>({
  get: () => accountId.value ?? undefined,
  set: (v) => {
    accountId.value = v ?? null
  }
})
</script>

<template>
  <UFormField
    label="Cuenta bancaria"
    name="accountId"
    :required="needsAccount"
    :help="
      needsAccount
        ? 'De qué cuenta sale o entra el dinero.'
        : 'Los pagos en efectivo no llevan cuenta.'
    "
  >
    <USelectMenu
      v-model="selected"
      :items="items"
      value-key="value"
      :disabled="!needsAccount || noAccounts"
      :loading="pending"
      :placeholder="needsAccount ? 'Elige una cuenta…' : 'Efectivo (sin cuenta)'"
      class="w-full"
    />
    <p v-if="noAccounts" class="mt-1 text-xs text-error">
      No hay cuentas bancarias activas. Da una de alta en
      <NuxtLink to="/cuentas" class="underline">Cuentas bancarias</NuxtLink>
      o registra el pago en efectivo.
    </p>
  </UFormField>
</template>
