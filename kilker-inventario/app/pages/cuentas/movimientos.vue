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
import { buildBanksMovementsDoc, fmtLedgerDate } from '~/utils/banksMovementsPdf'
import {
  CASH_FLOW_LABELS,
  PAYMENT_LABELS,
  SUGGESTED_CASH_FLOW_CONCEPTS
} from '~/types/inventario'

// El observador entra en modo consulta: ve el libro, no el alta. Mismo reparto
// que /cuentas.
definePageMeta({ requiresRole: ['admin', 'observador'] })
useHead({ title: 'Movimientos de banco · Inventario Kilker' })

// `globalBalance` sigue viniendo del endpoint, pero las tarjetas de saldo viven
// en el dashboard de banco: aquí no se destructura. `balances` sí, y sólo para
// ponerle nombre a la bolsa filtrada en el encabezado del PDF.
//
// ⚠️ Lo único que esta pantalla muestra en cifras es `filteredNet`, y NO es un
// saldo: es el neto de lo que quedó dentro del filtro. Por eso se rotula "neto
// del filtro" y no "saldo" — un saldo recalculado sobre "agosto" no es el saldo
// de nada (ver el encabezado del endpoint).
const {
  movements,
  balances,
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
  refresh,
  fetchAllFiltered
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
 * ⚠️ Vive en `utils/banksMovementsPdf.ts` y se importa, en vez de estar escrito
 * aquí, porque el PDF imprime estas mismas fechas: con dos copias, un arreglo en
 * una dejaba al PDF diciendo un día distinto que la pantalla. El motivo de no
 * usar `new Date()` está documentado allá (`new Date('2026-08-30')` es medianoche
 * UTC, que en México es todavía el 29).
 */
const fmtDateOnly = fmtLedgerDate

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
//  EXPORTAR A PDF
// ───────────────────────────────────────────────
// Saca en PDF los movimientos del filtro vigente CON su saldo corrido, con el
// formato de un estado de cuenta (utils/banksMovementsPdf.ts arma el documento).

/**
 * Qué universo cubre la columna de saldo, para rotularlo en el PDF.
 *
 * ⚠️ La bolsa es lo único que el saldo respeta del filtro (ver el endpoint). Sin
 * filtro de bolsa la columna es la suma de todas juntas, que no es el saldo de
 * ninguna cuenta en particular, y eso tiene que decirlo el papel.
 */
const balanceScope = computed(() => {
  if (account.value === 'cash') return 'Efectivo'
  const id = Number(account.value)
  if (id) return balances.value.find((b) => b.accountId === id)?.label ?? 'la bolsa filtrada'
  return 'todas las bolsas juntas'
})

/**
 * Último día INCLUIDO del periodo. `to` viene exclusivo de FiltroPeriodo (el día
 * siguiente al último), así que imprimirlo tal cual anunciaría un día de más.
 */
function lastIncludedDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  d.setDate(d.getDate() - 1)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Los filtros vigentes en texto, para el renglón gris del encabezado del PDF. */
function filterLines(): string[] {
  const lines = [
    from.value || to.value
      ? `${from.value ? fmtDateOnly(from.value) : 'Inicio'} – ${
          to.value ? fmtDateOnly(lastIncludedDay(to.value)) : 'hoy'
        }`
      : 'Todo el histórico',
    `Bolsa: ${balanceScope.value}`
  ]
  if (type.value) lines.push(`Clasificación: ${CASH_FLOW_LABELS[type.value] ?? type.value}`)
  if (source.value) lines.push(`Origen: ${source.value === 'manual' ? 'capturados a mano' : 'de documento'}`)
  if (search.value.trim()) lines.push(`Búsqueda: "${search.value.trim()}"`)
  return lines
}

const exporting = ref(false)

/**
 * ⚠️ Vuelve a pedir los movimientos SIN paginar (`fetchAllFiltered`) en vez de
 * imprimir `movements`: la tabla trae 100 filas y el PDF tiene que llevar todo
 * lo que el filtro abarca, no la página que se está viendo.
 *
 * pdfmake se importa bajo demanda —el bundle con las fuentes embebidas pesa
 * ~2 MB— igual que en el ticket de venta; el import dinámico además lo mantiene
 * fuera del bundle de servidor, porque sólo corre en el navegador.
 */
async function exportPdf() {
  exporting.value = true
  try {
    const rows = await fetchAllFiltered()
    const [{ default: pdfMake }, { default: vfs }, { KILKER_LOGO_PNG }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
      import('~/utils/brandLogo')
    ])
    pdfMake.addVirtualFileSystem(vfs)
    const generatedAt = new Date()
    pdfMake
      .createPdf(
        buildBanksMovementsDoc(
          rows,
          { balanceScope: balanceScope.value, filters: filterLines(), generatedAt },
          KILKER_LOGO_PNG
        )
      )
      .download(`movimientos-banco-${generatedAt.toISOString().slice(0, 10)}.pdf`)
  } catch (e) {
    toast.add({
      title: 'No se pudo generar el PDF',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    exporting.value = false
  }
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
      <div class="flex items-center gap-2">
        <!-- Exportar es una LECTURA: va fuera del `canEdit` del alta, para que el
             observador también pueda bajarlo (el endpoint ya se lo permite). -->
        <UButton
          icon="i-lucide-file-down"
          color="neutral"
          variant="outline"
          :loading="exporting"
          :disabled="pending || !total"
          @click="exportPdf"
        >
          Exportar PDF
        </UButton>
        <UButton v-if="canEdit" icon="i-lucide-plus" color="primary" @click="openNew">
          Nuevo movimiento
        </UButton>
      </div>
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
        <!-- Con un filtro puesto, dos renglones seguidos NO se diferencian por su
             importe: entre ellos hay movimientos que el filtro escondió y el
             saldo sí los cuenta. Decirlo aquí evita que parezca un error de
             cálculo (es lo mismo que hace un estado de cuenta filtrado). -->
        <p class="text-xs text-muted">
          La columna «Saldo» acumula todo el libro hasta cada movimiento, también
          lo que este filtro no muestra. Lo que suma exactamente lo visible es el
          neto del filtro.
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
              <th class="px-4 py-3 font-medium text-right">Saldo</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td colspan="7" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!movements.length">
              <td colspan="7" class="px-4 py-8 text-center text-muted">
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
              <!-- Saldo de la bolsa DESPUÉS de este movimiento, calculado por el
                   servidor sobre todo el libro. No se acumula aquí: con un filtro
                   puesto, sumar los importes visibles daría otro número. -->
              <td
                class="px-4 py-3 text-right font-semibold tabular-nums whitespace-nowrap"
                :class="m.balance < 0 ? 'text-error' : ''"
              >
                {{ currency.format(m.balance) }}
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
