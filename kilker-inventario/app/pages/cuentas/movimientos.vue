<script setup lang="ts">
// ───────────────────────────────────────────────
//  LIBRO DE DINERO — /cuentas/movimientos
// ───────────────────────────────────────────────
// Muestra TODO `banks_movements` (lo que asientan los pagos y lo que se captura
// a mano) y permite dar de alta los movimientos que no tienen documento detrás.
//
// ⚠️ El CONCEPTO se escribe libre. Lo que se guarda en `type` es una
// clasificación derivada de ese texto (ver `NAMED_CONCEPTS` en el endpoint):
// existe porque de ella dependen el signo permitido y los reportes, no para
// limitar lo que el usuario puede capturar.
//
// ⚠️ Este saldo NO cuadra contra "ventas del periodo", y no debe: lo que mueve
// dinero es el PAGO, no el documento. La diferencia es la cartera por cobrar y
// por pagar.
import type { ApiBanksMovement, PaymentMethod } from '~/types/inventario'
import FiltroPeriodo from '~/components/FiltroPeriodo.vue'
import {
  CASH_FLOW_LABELS,
  PAYMENT_LABELS,
  SUGGESTED_CASH_FLOW_CONCEPTS
} from '~/types/inventario'

// El observador entra en modo consulta: ve el libro, no el alta. Mismo reparto
// que /cuentas.
definePageMeta({ requiresRole: ['admin', 'observador'] })
useHead({ title: 'Movimientos de banco · Inventario Kilker' })

// `balances` y `globalBalance` siguen viniendo del endpoint, pero las tarjetas
// de saldo viven en el dashboard de banco: aquí no se destructuran.
//
// ⚠️ Lo único que esta pantalla muestra en cifras es `filteredNet`, y NO es un
// saldo: es el neto de lo que quedó dentro del filtro. Por eso se rotula "neto
// del filtro" y no "saldo" — un saldo recalculado sobre "agosto" no es el saldo
// de nada (ver el encabezado del endpoint).
const {
  movements,
  concepts,
  types,
  filteredNet,
  total,
  page,
  pageSize,
  pending,
  error,
  account,
  type,
  source,
  from,
  to,
  search,
  refresh
} = useBanksMovements()

const { me } = useMe()
const canEdit = computed(() => me.value?.role === 'admin')
const { data: stores } = useStores()
const toast = useToast()
const apiFetch = useApiFetch()

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

/**
 * Formatea una columna `date` (`YYYY-MM-DD`) SIN pasar por `new Date()`.
 *
 * ⚠️ `new Date('2026-08-30')` es medianoche UTC, que en México es todavía el 29:
 * la fecha se vería un día antes de la capturada. Es el mismo desfase de seis
 * horas que documenta `server/utils/businessTime.ts`.
 */
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function fmtDateOnly(s: string | null | undefined) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** Hoy en la hora LOCAL del navegador (que en México es la del negocio). */
function today(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// ───────────────────────────────────────────────
//  FILTROS
// ───────────────────────────────────────────────
// Solo las clasificaciones que existen en el libro, no el enum entero: éste
// conserva valores que ya no se capturan (Postgres no sabe quitarlos) y
// ofrecerlos sería dar filtros que nunca devuelven nada.
const typeFilterItems = computed(() => [
  { label: 'Todas las clasificaciones', value: undefined },
  ...types.value.map((t) => ({ label: CASH_FLOW_LABELS[t] ?? t, value: t }))
])

// `account` y `source` siguen en el composable y en el endpoint aunque la
// pantalla ya no ofrezca sus selectores: los limpia `clearFilters` y así, si se
// vuelven a montar, no arrastran un filtro invisible.
const hasFilters = computed(
  () => !!(account.value || type.value || source.value || from.value || to.value || search.value.trim())
)

function clearFilters() {
  account.value = ''
  type.value = undefined
  source.value = ''
  from.value = undefined
  to.value = undefined
  search.value = ''
}

// ───────────────────────────────────────────────
//  PRESENTACIÓN DE UNA FILA
// ───────────────────────────────────────────────
const SOURCE_LABELS: Record<ApiBanksMovement['source'], string> = {
  venta: 'Venta',
  entrada: 'Entrada',
  gasto: 'Gasto',
  anulacion: 'Anulación',
  manual: 'Manual'
}

const SOURCE_COLORS: Record<ApiBanksMovement['source'], 'primary' | 'warning' | 'neutral' | 'error' | 'info'> = {
  venta: 'primary',
  entrada: 'info',
  gasto: 'warning',
  anulacion: 'error',
  manual: 'neutral'
}

/**
 * Lo que se muestra como concepto: el texto del usuario cuando existe, y si no
 * la etiqueta de la clasificación (los movimientos que asienta un pago no
 * llevan texto libre).
 */
function conceptOf(m: ApiBanksMovement) {
  return m.concept ?? CASH_FLOW_LABELS[m.type]
}

/** El sentido se lee del SIGNO, nunca del concepto (convención de la tabla). */
function isInflow(m: ApiBanksMovement) {
  return Number(m.amount) >= 0
}

// ───────────────────────────────────────────────
//  ALTA DE MOVIMIENTO MANUAL
// ───────────────────────────────────────────────
const showModal = ref(false)
const submitting = ref(false)

const form = reactive({
  concept: '',
  direction: 'out' as 'in' | 'out',
  amount: undefined as number | undefined,
  occurredAt: '',
  method: 'efectivo' as PaymentMethod,
  /** null = efectivo. Lo llena SelectorCuentaPago. */
  accountId: null as number | null,
  storeId: undefined as number | undefined,
  note: ''
})

const methodItems = (Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((v) => ({
  label: PAYMENT_LABELS[v],
  value: v
}))

const storeItems = computed(() => [
  { label: 'Sin sucursal', value: 0 },
  ...stores.value
    .filter((s) => s.isActive)
    .map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])

/**
 * Sugerencias del campo de concepto: los que ya se usaron, más la semilla para
 * cuando no hay ninguno.
 *
 * ⚠️ Sugerir no limita ni reserva nada: el campo es texto libre y el servidor no
 * trata distinto a ninguno de estos textos. Están para que repetir sea más fácil
 * que inventar una quinta forma de escribir "nómina".
 */
const conceptSuggestions = computed(() => {
  const seeds = SUGGESTED_CASH_FLOW_CONCEPTS.filter(
    (s) => !concepts.value.some((c) => c.toLowerCase() === s.toLowerCase())
  )
  return [...seeds, ...concepts.value]
})

/** Minúsculas y sin acentos. Espejo de `normalize` en el endpoint. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const previewAmount = computed(() => {
  const n = Number(form.amount)
  if (!Number.isFinite(n) || n <= 0) return null
  return (form.direction === 'in' ? 1 : -1) * n
})

const directionItems = [
  { label: 'Entra dinero (+)', value: 'in' },
  { label: 'Sale dinero (−)', value: 'out' }
]

function openNew() {
  Object.assign(form, {
    concept: '',
    direction: 'out',
    amount: undefined,
    occurredAt: today(),
    method: 'efectivo',
    accountId: null,
    storeId: undefined,
    note: ''
  })
  showModal.value = true
}

const CONCEPT_MAX = 80

const canSubmit = computed(
  () =>
    canEdit.value &&
    form.concept.trim().length > 0 &&
    form.concept.trim().length <= CONCEPT_MAX &&
    (form.amount ?? 0) > 0 &&
    form.occurredAt.length > 0 &&
    // Misma regla método ↔ cuenta que los modales de pago; el candado real es
    // `resolvePaymentAccount` en el servidor.
    isPaymentAccountValid(form.method, form.accountId)
)

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    await apiFetch('/api/banks-movements', {
      method: 'POST',
      body: {
        concept: form.concept.trim(),
        // El importe va SIEMPRE positivo: el signo lo pone el servidor a partir
        // del sentido, para que no haya dos lugares donde pueda invertirse.
        amount: form.amount,
        direction: form.direction,
        occurredAt: form.occurredAt,
        method: form.method,
        accountId: form.accountId,
        storeId: form.storeId || null,
        note: form.note.trim() || undefined
      }
    })
    toast.add({ title: 'Movimiento registrado', color: 'success', icon: 'i-lucide-circle-check' })
    showModal.value = false
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo registrar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Movimientos de banco</h1>
        <p class="text-sm text-muted">
          Todo el dinero que entra y sale · el efectivo va como bolsa aparte
        </p>
      </div>
      <UButton v-if="canEdit" icon="i-lucide-plus" color="primary" @click="openNew">
        Nuevo movimiento
      </UButton>
    </header>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudo cargar el movimiento de dinero"
      :description="error"
    />

     <!-- <UCard :ui="{ body: 'p-4 sm:p-4' }" class="bg-elevated/50">
        <p class="text-sm font-medium">Saldo global</p>
        <p class="text-xs text-muted">Todas las bolsas juntas</p>
        <p
          class="mt-2 text-xl font-semibold tabular-nums"
          :class="globalBalance < 0 ? 'text-error' : ''"
        >
          {{ currency.format(globalBalance) }}
        </p>
      </UCard>  -->

    <!-- Filtros -->
      <FiltroPeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        search-placeholder="Buscar por concepto, nota o bolsa (banco, titular, ····1234, efectivo)…"
      />
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <USelect v-model="type" :items="typeFilterItems" class="w-56" placeholder="Tipo de movimiento" />
        <!-- Siempre visible y deshabilitado cuando no hay nada que limpiar: los
             filtros de esta pantalla viven en `useState`, o sea que sobreviven a
             la navegación, y un periodo puesto hace dos días sigue aplicado al
             volver. Escondiendo el botón, eso solo se ve cuando ya se sospecha. -->
        <BotonLimpiarFiltros class="ml-auto" :active="hasFilters" @clear="clearFilters" />
      </div>
      <div v-if="hasFilters" class="mt-3">
        <p class="text-sm text-muted">
          {{ total }} movimiento(s) ·
          <!-- Neto del filtro, NO un saldo: por eso se nombra distinto. -->
          neto del filtro
          <span class="font-medium tabular-nums" :class="filteredNet < 0 ? 'text-error' : ''">
            {{ currency.format(filteredNet) }}
          </span>
        </p>
      </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium">Concepto</th>
              <th class="px-4 py-3 font-medium">Bolsa</th>
              <th class="px-4 py-3 font-medium">Nota</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium text-right">Importe</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="6" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!movements.length">
              <td colspan="6" class="px-4 py-8 text-center text-muted">
                No hay movimientos con estos filtros.
              </td>
            </tr>
            <tr v-for="m in movements" v-else :key="m.id" class="hover:bg-elevated/50">
              <td class="px-4 py-3 whitespace-nowrap">{{ fmtDateOnly(m.occurredAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                  <span>{{ conceptOf(m) }}</span>
                  <UBadge
                    :label="SOURCE_LABELS[m.source]"
                    :color="SOURCE_COLORS[m.source]"
                    variant="subtle"
                    size="sm"
                  />
                  <!-- ⚠️ El libro es append-only: un movimiento revertido NO se
                       borra, se queda con su reversa al lado. Sin este aviso se
                       leía como dinero vivo — una venta decía "pendiente" y su
                       cobro seguía aquí como si hubiera entrado. -->
                  <UBadge
                    v-if="m.reversedById"
                    label="Anulado"
                    color="error"
                    variant="soft"
                    size="sm"
                  />
                </div>
                <p class="text-xs text-muted">
                  {{ m.method ? PAYMENT_LABELS[m.method] : '—' }}
                  <span v-if="m.createdByName"> · {{ m.createdByName }}</span>
                </p>
              </td>
              <td class="px-4 py-3 text-xs">
                {{ m.accountLabel ?? 'Efectivo' }}
              </td>
              <td class="px-4 py-3 text-xs text-muted">{{ m.note ?? '—' }}</td>
              <td class="px-4 py-3 text-xs text-muted">
                {{ m.storeCode ?? '—' }}
              </td>
              <td
                class="px-4 py-3 text-right font-medium tabular-nums whitespace-nowrap"
                :class="isInflow(m) ? 'text-success' : 'text-error'"
              >
                {{ currency.format(Number(m.amount)) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <div v-if="total > pageSize" class="flex justify-center">
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
    </div>

    <!-- Alta de movimiento manual -->
    <UModal v-model:open="showModal">
      <template #content>
        <UCard :ui="{ body: 'max-h-[75vh] overflow-y-auto' }">
          <template #header>
            <h2 class="font-semibold">Nuevo movimiento de banco</h2>
          </template>

          <form class="space-y-4" @submit.prevent="onSubmit">
            <!-- <UAlert
              color="neutral"
              variant="subtle"
              icon="i-lucide-info"
              description="Los cobros de ventas y los pagos de entradas y gastos se asientan solos
                al registrar el pago del documento. Aquí solo va el dinero que no tiene
                documento detrás."
            /> -->

            <UFormField
              label="Concepto"
              required
              :help="`Escríbelo como quieras (máx. ${CONCEPT_MAX} caracteres).`"
            >
              <UInput
                v-model="form.concept"
                placeholder="Ej. Saldo inicial"
                :maxlength="CONCEPT_MAX"
                class="w-full"
              />
              <div class="mt-2 flex flex-wrap gap-1">
                <UButton
                  v-for="c in conceptSuggestions"
                  :key="c"
                  size="xs"
                  color="neutral"
                  :variant="normalize(form.concept) === normalize(c) ? 'solid' : 'outline'"
                  @click="form.concept = c"
                >
                  {{ c }}
                </UButton>
              </div>
            </UFormField>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Sentido" required help="¿El dinero entra o sale?">
                <USelect v-model="form.direction" :items="directionItems" class="w-full" />
              </UFormField>

              <UFormField
                label="Importe"
                required
                :help="
                  previewAmount != null
                    ? `Se asienta como ${currency.format(previewAmount)}`
                    : 'Captúralo en positivo; el signo lo pone el sentido.'
                "
              >
                <UInput
                  v-model.number="form.amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Fecha" required>
                <UInput v-model="form.occurredAt" type="date" class="w-full" />
              </UFormField>
              <UFormField label="Método" required>
                <USelect v-model="form.method" :items="methodItems" class="w-full" />
              </UFormField>
            </div>

            <SelectorCuentaPago v-model="form.accountId" :method="form.method" />

            <UFormField
              label="Sucursal"
              help="Opcional, solo informativo: el saldo es por cuenta, no por sucursal."
            >
              <USelect
                :model-value="form.storeId ?? 0"
                :items="storeItems"
                class="w-full"
                @update:model-value="form.storeId = Number($event) || undefined"
              />
            </UFormField>

            <UFormField label="Nota" help="Opcional: el detalle que no cabe en el concepto.">
              <UTextarea
                v-model="form.note"
                :rows="2"
                placeholder="Ej. Saldo inicial"
                class="w-full"
              />
            </UFormField>

            <div class="flex justify-end gap-2">
              <UButton
                type="button"
                color="neutral"
                variant="ghost"
                @click="showModal = false"
              >
                Cancelar
              </UButton>
              <UButton
                type="submit"
                icon="i-lucide-save"
                color="primary"
                :loading="submitting"
                :disabled="!canSubmit"
              >
                Registrar
              </UButton>
            </div>
          </form>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>
