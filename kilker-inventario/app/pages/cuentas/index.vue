<script setup lang="ts">
import type { ApiBankAccount } from '~/types/inventario'



// El observador entra en modo consulta: ve la lista, no el alta.
definePageMeta({ requiresRole: ['admin', 'observador'] })
useHead({ title: 'Cuentas bancarias · Inventario Kilker' })

const { me } = useMe()
const canEdit = computed(() => me.value?.role === 'admin')

const toast = useToast()
const { accounts, pending, error, refresh } = useBankAccounts()
const apiFetch = useApiFetch()

// Estado del formulario: null = cerrado; 0 = nueva; >0 = editando esa cuenta.
// Mismo esquema que /tiendas.
const editingId = ref<number | null>(null)
const formBank = ref('')
const formOwner = ref('')
const formCardLast4 = ref('')
const formIsActive = ref(true)
/** Pagos de la cuenta en edición: si tiene, los últimos 4 quedan bloqueados. */
const formPaymentCount = ref(0)
const saving = ref(false)
const togglingId = ref<number | null>(null)

const isOpen = computed(() => editingId.value !== null)
const isNew = computed(() => editingId.value === 0)
/**
 * ⚠️ Espejo de la regla del servidor: los últimos 4 identifican el plástico, así
 * que cambiarlos en una cuenta con pagos reatribuiría todo su historial a otra
 * tarjeta. Esto solo esconde el campo; el candado real es el 409 del PATCH.
 */
const cardLocked = computed(() => !isNew.value && formPaymentCount.value > 0)

function openNew() {
  editingId.value = 0
  formBank.value = ''
  formOwner.value = ''
  formCardLast4.value = ''
  formIsActive.value = true
  formPaymentCount.value = 0
}

function openEdit(a: ApiBankAccount) {
  editingId.value = a.id
  formBank.value = a.bank
  formOwner.value = a.owner
  formCardLast4.value = a.cardLast4 ?? ''
  formIsActive.value = a.isActive
  formPaymentCount.value = a.paymentCount ?? 0
}

function closeForm() {
  editingId.value = null
}

/** Solo dígitos y máximo 4: la primera defensa contra pegar la tarjeta entera. */
function onCardInput(value: string | number) {
  formCardLast4.value = String(value).replace(/\D/g, '').slice(0, 4)
}

async function save() {
  const bank = formBank.value.trim()
  const owner = formOwner.value.trim()
  const cardLast4 = formCardLast4.value.trim()

  if (!bank) {
    toast.add({ title: 'El banco es obligatorio', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  if (!owner) {
    toast.add({ title: 'El titular es obligatorio', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  // Se permite vacío (cuenta sin plástico), pero no 1-3 dígitos sueltos.
  if (cardLast4 && !/^\d{4}$/.test(cardLast4)) {
    toast.add({
      title: 'Los últimos 4 dígitos deben ser 4 números',
      description: 'Déjalo vacío si la cuenta no tiene tarjeta.',
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
    return
  }

  saving.value = true
  try {
    if (isNew.value) {
      await apiFetch('/api/bank-accounts', {
        method: 'POST',
        body: { bank, owner, cardLast4: cardLast4 || null }
      })
      toast.add({ title: 'Cuenta creada', color: 'success', icon: 'i-lucide-circle-check' })
    } else {
      await apiFetch(`/api/bank-accounts/${editingId.value}`, {
        method: 'PATCH',
        body: {
          bank,
          owner,
          // Cuando está bloqueado no se manda: el servidor solo compara el campo
          // si viene en el body, y mandarlo igual sería pedirle que valide algo
          // que el usuario no pudo tocar.
          ...(cardLocked.value ? {} : { cardLast4: cardLast4 || null }),
          isActive: formIsActive.value
        }
      })
      toast.add({ title: 'Cuenta actualizada', color: 'success', icon: 'i-lucide-circle-check' })
    }
    await refresh()
    closeForm()
  } catch (e) {
    toast.add({
      title: 'No se pudo guardar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    saving.value = false
  }
}

async function toggleActive(a: ApiBankAccount) {
  togglingId.value = a.id
  try {
    await apiFetch(`/api/bank-accounts/${a.id}`, {
      method: 'PATCH',
      body: { isActive: !a.isActive }
    })
    const n = a.paymentCount ?? 0
    toast.add({
      title: a.isActive ? 'Cuenta desactivada' : 'Cuenta activada',
      // Desactivar es baja suave: no desliga los pagos históricos ni cambia
      // ningún saldo, solo deja de ofrecerse para pagos nuevos.
      description:
        a.isActive && n > 0
          ? `Sus ${n} pago(s) registrados no cambian; solo deja de ofrecerse para pagos nuevos.`
          : undefined,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo cambiar el estado',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    togglingId.value = null
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Cuentas bancarias</h1>
        <p class="text-sm text-muted">
          {{ accounts.length }} cuenta(s) · de aquí se eligen al registrar un pago
        </p>
      </div>
      <UButton
        v-if="canEdit"
        icon="i-lucide-plus"
        color="primary"
        :disabled="isNew"
        @click="openNew"
      >
        Nueva cuenta
      </UButton>
    </header>

  

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudieron cargar las cuentas"
      :description="error"
    />

    <!-- Formulario de alta/edición (inline, como en /tiendas) -->
    <UCard v-if="isOpen">
      <template #header>
        <h2 class="font-semibold">{{ isNew ? 'Nueva cuenta' : 'Editar cuenta' }}</h2>
      </template>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField label="Banco" name="bank" required>
            <UInput v-model="formBank" placeholder="Ej. BBVA" class="w-full" autofocus />
          </UFormField>
          <UFormField label="Titular" name="owner" required help="A nombre de quién está la cuenta">
            <UInput v-model="formOwner" placeholder="Ej. Pinturas Kilker S.A. de C.V." class="w-full" />
          </UFormField>
          <UFormField
            label="Últimos 4 dígitos"
            name="cardLast4"
            :help="
              cardLocked
                ? `No editable: la cuenta ya tiene ${formPaymentCount} pago(s). Si es otra tarjeta, dala de alta aparte.`
                : 'Opcional. Solo los últimos 4: el número completo no se guarda.'
            "
          >
            <UInput
              :model-value="formCardLast4"
              placeholder="4321"
              inputmode="numeric"
              maxlength="4"
              autocomplete="off"
              class="w-full font-mono"
              :disabled="cardLocked"
              @update:model-value="onCardInput"
            />
          </UFormField>
        </div>
        <div v-if="!isNew" class="flex items-center gap-2">
          <USwitch v-model="formIsActive" />
          <span class="text-sm">{{ formIsActive ? 'Activa' : 'Inactiva' }}</span>
        </div>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="ghost" @click="closeForm">
            Cancelar
          </UButton>
          <UButton type="submit" icon="i-lucide-save" color="primary" :loading="saving">
            Guardar
          </UButton>
        </div>
      </form>
    </UCard>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Banco</th>
              <th class="px-4 py-3 font-medium">Titular</th>
              <th class="px-4 py-3 font-medium">Tarjeta</th>
              <!-- <th class="px-4 py-3 font-medium text-right">Pagos</th> -->
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="6" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!accounts.length">
              <td colspan="6" class="px-4 py-8 text-center text-muted">
                Aún no hay cuentas. Crea la primera.
              </td>
            </tr>
            <tr v-for="a in accounts" v-else :key="a.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 font-medium">{{ a.bank }}</td>
              <td class="px-4 py-3">{{ a.owner }}</td>
              <td class="px-4 py-3 font-mono text-xs text-muted">
                {{ a.cardLast4 ? `•••• ${a.cardLast4}` : '—' }}
              </td>
              <!-- <td class="px-4 py-3 text-right tabular-nums">{{ a.paymentCount ?? 0 }}</td> -->
              <td class="px-4 py-3 text-center">
                <UBadge
                  :label="a.isActive ? 'Activa' : 'Inactiva'"
                  :color="a.isActive ? 'success' : 'neutral'"
                  variant="subtle"
                />
              </td>
              <td class="px-4 py-3">
                <div v-if="canEdit" class="flex items-center justify-end gap-1">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-pencil"
                    @click="openEdit(a)"
                  />
                  <UButton
                    size="xs"
                    :color="a.isActive ? 'error' : 'success'"
                    variant="ghost"
                    :icon="a.isActive ? 'i-lucide-power-off' : 'i-lucide-power'"
                    :loading="togglingId === a.id"
                    @click="toggleActive(a)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </UContainer>
</template>
