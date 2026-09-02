<!-- pages/ventas/index.vue -->
<script setup lang="ts">
import type {
  ApiSale,
  ApiSaleDetail,
  ApiSaleItem,
  ApiSalePayment,
  PaymentMethod,
  SalePaymentStatus
} from '~/types/inventario'
import { PAYMENT_LABELS, SALE_PAYMENT_STATUS_LABELS } from '~/types/inventario'
import type { TicketGroup } from '~/utils/ticket'
import { groupSaleItemsByKit } from '~/utils/ticket'
import { buildSaleTicketDoc } from '~/utils/ticketPdf'
import * as XLSX from 'xlsx'
import FiltroPeriodo from '~/components/FiltroPeriodo.vue'

const { sales, total, totals, page, pageSize, pending, error, status, storeId, productId, from, to, search, refresh } = useSalesHistory()

useHead({ title: 'Historial de ventas · Inventario Kilker' })

const toast = useToast()
const { me, canWrite, seesAllStores } = useMe()
const isAdmin = computed(() => me.value?.role === 'admin')

const { data: stores } = useStores()
const { products } = useAllProducts()
const apiFetch = useApiFetch()

// Exportaciones: useAllSales manda ?all=true. Antes pedían /api/sales sin ese
// flag, y el endpoint recortaba a 200 facturas sin avisar — los Excel salían
// truncados en cuanto el periodo pasaba de 200 ventas.
const { refresh: fetchAllSales } = useAllSales()

const viewingId = ref<number | null>(null)
const detail = ref<ApiSaleDetail | null>(null)
const loadingDetail = ref(false)
const showDetailModal = ref(false)

// Estado compartido: refrescamos al entrar para no mostrar datos viejos.


if (import.meta.client) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh()
    }
  })
}

const statusItems = [
  { label: 'Todas', value: 'todas' },
  { label: 'Emitidas', value: 'emitida' },
  { label: 'Anuladas', value: 'anulada' }
]
const storeItems = computed(() => [
  { label: 'Todas las sucursales', value: 0 },
  ...stores.value.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))
])

const productItems = computed(() => [
  { label: 'Todos los productos', value: undefined },
  ...products.value.map((p) => ({ label: `${p.sku} — ${p.name}`, value: p.id }))
])
// El filtro de tienda usa 0 = todas; lo mapeamos al ref (undefined = todas).
const storeFilter = computed({
  get: () => storeId.value ?? 0,
  set: (v: number) => {
    storeId.value = v || undefined
  }
})

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return '—'
  return dateFmt.format(d)
}
// Las fechas de pago son `date` (sin hora): se leen como local, no como UTC, o
// el día se corre uno hacia atrás.
// ─── Asignación masiva de cuenta (corrección / relleno del histórico) ───
// Los pagos en efectivo NO cuentan: no llevan cuenta ni deben llevarla.
const bankPaymentCount = computed(
  () => payments.value.filter((p) => p.method !== 'efectivo').length
)
const assignedAccountCount = computed(
  () => payments.value.filter((p) => p.method !== 'efectivo' && p.accountId != null).length
)

const dayFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })
function fmtDay(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(`${s}T00:00:00`)
  if (isNaN(d.getTime())) return '—'
  return dayFmt.format(d)
}

// Anulación (solo admin): confirmación inline con motivo.
const voidingId = ref<number | null>(null)
const voidReason = ref('')
const submittingVoid = ref(false)

function openVoid(sale: ApiSale) {
  voidingId.value = sale.id
  voidReason.value = ''
}
function cancelVoid() {
  voidingId.value = null
  voidReason.value = ''
}

async function confirmVoid(sale: ApiSale) {
  submittingVoid.value = true
  try {
    const res = await apiFetch<{ deletedPayments: number }>(`/api/sales/${sale.id}/void`, {
      method: 'POST',
      body: { reason: voidReason.value.trim() || undefined }
    })
    const borrados = res?.deletedPayments ?? 0
    toast.add({
      title: `Venta ${sale.folio} anulada`,
      description:
        borrados > 0
          ? `Se repuso el inventario y se borraron ${borrados} pago(s).`
          : 'Se repuso el inventario.',
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    cancelVoid()
    await refresh()
    await refreshNuxtData('products')
  } catch (e) {
    toast.add({
      title: 'No se pudo anular',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submittingVoid.value = false
  }
}

// El EMPLEADO no anula: abre un ticket de corrección que el admin resolverá.
const requestingId = ref<number | null>(null)
const requestReason = ref('')
const submittingRequest = ref(false)

function openRequest(sale: ApiSale) {
  requestingId.value = sale.id
  requestReason.value = ''
}
function cancelRequest() {
  requestingId.value = null
  requestReason.value = ''
}

async function confirmRequest(sale: ApiSale) {
  if (!requestReason.value.trim()) {
    toast.add({ title: 'Escribe el motivo', color: 'error', icon: 'i-lucide-triangle-alert' })
    return
  }
  submittingRequest.value = true
  try {
    await apiFetch('/api/tickets', {
      method: 'POST',
      body: { invoiceId: sale.id, reason: requestReason.value.trim() }
    })
    toast.add({
      title: 'Solicitud enviada',
      description: `Se abrió un ticket para anular ${sale.folio}. Un admin lo revisará.`,
      color: 'success',
      icon: 'i-lucide-circle-check'
    })
    cancelRequest()
    await refresh()
  } catch (e) {
    toast.add({
      title: 'No se pudo enviar la solicitud',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submittingRequest.value = false
  }
}

async function openDetail(sale: ApiSale) {
  viewingId.value = sale.id
  detail.value = null
  showDetailModal.value = true
  loadingDetail.value = true
  try {
    detail.value = await apiFetch<ApiSaleDetail>(`/api/sales/${sale.id}`)
  } catch (e) {
    toast.add({
      title: 'No se pudo cargar el detalle',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
    showDetailModal.value = false
  } finally {
    loadingDetail.value = false
  }
}

// ───────────────────────────────────────────────
//  MODAL DE PAGOS DE LA VENTA
// ───────────────────────────────────────────────
// El cobrable es el total de la factura: ya trae el descuento aplicado y va sin
// IVA (el 16% que muestra el detalle es informativo y no se guarda). No se
// captura "quién pagó" como en gastos: quien paga es el cliente de la factura.
const viewingSale = ref<ApiSale | null>(null)
const showPaymentsModal = ref(false)
const payments = ref<ApiSalePayment[]>([])
const loadingPayments = ref(false)
const submittingPayment = ref(false)

const paymentMethodItems = (Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((v) => ({
  label: PAYMENT_LABELS[v],
  value: v
}))

const PAYMENT_STATUS_COLORS: Record<SalePaymentStatus, 'success' | 'warning' | 'error' | 'neutral'> = {
  pagado: 'success',
  parcial: 'warning',
  pendiente: 'error',
  anulada: 'neutral'
}

const paymentForm = reactive({
  amount: undefined as number | undefined,
  paidAt: '',
  method: 'efectivo' as PaymentMethod,
  /** null = efectivo. Lo llena SelectorCuentaPago. */
  accountId: null as number | null,
  note: ''
})

async function openPayments(sale: ApiSale) {
  viewingSale.value = sale
  showPaymentsModal.value = true
  Object.assign(paymentForm, {
    amount: undefined,
    paidAt: new Date().toISOString().slice(0, 10),
    // Precargado con el metodo elegido al vender; el cobro real puede diferir.
    method: sale.paymentMethod,
    accountId: null,
    note: ''
  })
  await refreshPayments()
}

async function refreshPayments() {
  if (!viewingSale.value) return
  loadingPayments.value = true
  try {
    payments.value = await apiFetch<ApiSalePayment[]>(
      `/api/sales/${viewingSale.value.id}/payments`
    )
  } catch (e) {
    toast.add({
      title: 'No se pudieron cargar los pagos',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    loadingPayments.value = false
  }
}

const canSubmitPayment = computed(
  () =>
    canWrite.value &&
    !!viewingSale.value &&
    viewingSale.value.status !== 'anulada' &&
    (paymentForm.amount ?? 0) > 0 &&
    paymentForm.paidAt.length > 0 &&
    isPaymentAccountValid(paymentForm.method, paymentForm.accountId) &&
    // Mismo tope que aplica el servidor; aquí solo evita el viaje perdido.
    (paymentForm.amount ?? 0) <= viewingSale.value.balance + 0.01
)

async function submitPayment() {
  if (!canSubmitPayment.value || !viewingSale.value) return
  submittingPayment.value = true
  try {
    await apiFetch(`/api/sales/${viewingSale.value.id}/payments`, {
      method: 'POST',
      body: {
        amount: paymentForm.amount,
        paidAt: paymentForm.paidAt,
        method: paymentForm.method,
        accountId: paymentForm.accountId,
        note: paymentForm.note.trim() || undefined
      }
    })
    toast.add({ title: 'Pago registrado', color: 'success', icon: 'i-lucide-circle-check' })
    // La cuenta y el método NO se limpian: varios abonos seguidos casi siempre
    // entran a la misma cuenta.
    Object.assign(paymentForm, { amount: undefined, note: '' })
    await refreshPayments()
    await refresh()
    // La fila del listado trae el saldo recalculado; hay que reapuntar el modal
    // a ella o seguiría mostrando el saldo viejo.
    const updated = sales.value.find((x) => x.id === viewingSale.value?.id)
    if (updated) viewingSale.value = updated
  } catch (e) {
    toast.add({
      title: 'No se pudo registrar el pago',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    submittingPayment.value = false
  }
}

const downloadingTicket = ref(false)

/**
 * Descarga el ticket de la venta abierta como PDF (utils/ticketPdf.ts arma el
 * documento). pdfmake se importa bajo demanda porque el bundle con las fuentes
 * embebidas pesa ~2 MB: cargarlo de entrada penalizaría a todas las páginas
 * para algo que sólo se usa al pedir un ticket. El import dinámico además lo
 * mantiene fuera del bundle de servidor (pdfmake sólo corre en el navegador).
 * El logotipo va en el mismo lote por lo mismo: es base64 y sólo hace falta aquí.
 */
async function downloadTicket() {
  if (!detail.value) return
  downloadingTicket.value = true
  try {
    const [{ default: pdfMake }, { default: vfs }, { KILKER_LOGO_PNG }] = await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
      import('~/utils/brandLogo')
    ])
    // Las fuentes van en base64 dentro del propio bundle: nada de archivos ni
    // de rutas, que es lo que rompería esto en Vercel si fuera del lado servidor.
    pdfMake.addVirtualFileSystem(vfs)
    pdfMake
      .createPdf(buildSaleTicketDoc(detail.value, KILKER_LOGO_PNG))
      .download(`ticket-${detail.value.folio}.pdf`)
  } catch (e) {
    toast.add({
      title: 'No se pudo generar el PDF',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    downloadingTicket.value = false
  }
}

const exportingAll = ref(false)
const exportingFiltered = ref(false)

/** Celda de Excel: SheetJS acepta string o number tal cual. */
type SheetRow = Record<string, string | number>

const round2 = (n: number) => Math.round(n * 100) / 100

/** Kits distintos que participan en la venta (las líneas vienen explotadas). */
function kitCount(s: ApiSale) {
  const ids = new Set<number>()
  for (const it of s.items) if (it.kitId != null) ids.add(it.kitId)
  return ids.size
}

/**
 * Ordena las líneas para el Excel: primero los productos sueltos y después
 * cada kit con sus componentes juntos. El API no garantiza orden, y un kit
 * partido en renglones salteados es ilegible en la hoja.
 */
function itemsGroupedByKit(items: ApiSaleItem[]): ApiSaleItem[] {
  const loose: ApiSaleItem[] = []
  const byKit = new Map<number, ApiSaleItem[]>()
  for (const it of items) {
    if (it.kitId == null) {
      loose.push(it)
      continue
    }
    const group = byKit.get(it.kitId)
    if (group) group.push(it)
    else byKit.set(it.kitId, [it])
  }
  return [...loose, ...[...byKit.values()].flat()]
}


function totalsToSheet(sales: ApiSale[]): SheetRow[] {
  const bucket = (rows: ApiSale[]) => {
    const total = round2(rows.reduce((acc, s) => acc + Number(s.totalAmount), 0))
    // IVA del bucket: 16% del total del bucket, NO la suma de los IVA por
    // factura (redondear factura por factura y luego sumar deja centavos de
    // diferencia contra "Total con IVA").
    const iva = ivaOf(total)
    return {
      Facturas: rows.length,
      Subtotal: round2(rows.reduce((acc, s) => acc + Number(s.subtotalAmount), 0)),
      Descuento: round2(rows.reduce((acc, s) => acc + Number(s.discountAmount), 0)),
      Total: total,
      'IVA (16%)': iva,
      'Total con IVA': round2(total + iva)
    }
  }

  return [
    { Concepto: 'Ventas emitidas', ...bucket(sales.filter((s) => s.status !== 'anulada')) },
    { Concepto: 'Ventas anuladas', ...bucket(sales.filter((s) => s.status === 'anulada')) },
    { Concepto: 'Total general', ...bucket(sales) }
  ]
}

// Hoja 1: resumen de ventas
function salesToSheet(rows: ApiSale[]) {
  return rows.map((s) => ({
    Folio: s.folio ?? '',
    Fecha: fmtDate(s.issuedAt),
    Sucursal: s.storeCode ?? '',
    Cliente: s.customerName ?? 'Sin cliente',
    Kits: kitCount(s),
    'Productos (líneas)': s.itemCount,
    Subtotal: round2(Number(s.subtotalAmount)),
    'Descuento %': Number(s.discountPct),
    Descuento: round2(Number(s.discountAmount)),
    Total: round2(Number(s.totalAmount)),
    // El IVA no vive en la BD: es el 16% informativo que la app calcula sobre
    // el total (que ya trae el descuento aplicado).
    'IVA (16%)': ivaOf(Number(s.totalAmount)),
    'Total con IVA': round2(Number(s.totalAmount) + ivaOf(Number(s.totalAmount))),
    Canal: s.channel === 'en_linea' ? 'En línea' : 'Mostrador',
    Estado: s.status === 'anulada' ? 'Anulada' : 'Emitida',
    // Pagado: round2(s.totalPaid ?? 0),
    // Saldo: round2(s.balance ?? 0),
    // 'Estado de pago': SALE_PAYMENT_STATUS_LABELS[s.paymentStatus] ?? '',
    Creó: s.createdByName ?? ''
  }))
}



function saleItemsToSheet(sales: ApiSale[]) {
  const rows: SheetRow[] = []
  for (const s of sales) {
    const factor = 1 - Number(s.discountPct ?? 0) / 100
    const items = itemsGroupedByKit(s.items)
    const saleRows: SheetRow[] = []

    for (const it of items) {
      saleRows.push({
        Folio: s.folio ?? '',
        Fecha: fmtDate(s.issuedAt),
        Sucursal: s.storeCode ?? '',
        Cliente: s.customerName ?? 'Sin cliente',
        // Una muestra sale del mismo producto y a precio 0: sin esta columna,
        // en la hoja parecería un producto regalado sin explicación.
        Tipo: it.sampleProductId != null ? 'Muestra' : it.kitId != null ? 'Kit' : 'Suelto',
        'SKU muestra': it.sampleSku ?? '',
        Kit: it.kitName ?? '',
        'SKU kit': it.kitSku ?? '',
        'Cant. kits': it.kitQuantity != null ? Number(it.kitQuantity) : '',
        Producto: it.productName ?? '',
        SKU: it.productSku ?? '',
        Cantidad: Number(it.quantity),
        'Precio unitario': Number(it.unitPrice),
        'Total línea': round2(Number(it.lineTotal)),
        'Descuento %': Number(s.discountPct),
        'Total con descuento': round2(Number(it.lineTotal) * factor),
        Estado: s.status === 'anulada' ? 'Anulada' : 'Emitida'
      })
    }

    // Cuadre exacto contra la hoja 1: el redondeo por línea puede dejar un
    // par de centavos de diferencia; se ajusta la última línea de la venta.
    const last = saleRows[saleRows.length - 1]
    if (last) {
      const sum = saleRows.reduce((acc, r) => acc + Number(r['Total con descuento']), 0)
      const residual = round2(round2(Number(s.totalAmount)) - sum)
      if (residual !== 0) {
        last['Total con descuento'] = round2(Number(last['Total con descuento']) + residual)
      }
    }

    rows.push(...saleRows)
  }
  return rows
}

/** Filtro por encabezado en Excel. `!ref` de json_to_sheet ya es header + datos. */
function addAutofilter(sheet: XLSX.WorkSheet) {
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] }
}

function downloadSalesWorkbook(sales: ApiSale[], filenamePrefix: string) {
  const workbook = XLSX.utils.book_new()

  // Hoja 0: va primera porque es la que responde "¿cuánto vendí?" sin filtrar.
  const totalsSheet = XLSX.utils.json_to_sheet(totalsToSheet(sales))
  // Concepto, Facturas, Subtotal, Descuento, Total, IVA (16%), Total con IVA
  totalsSheet['!cols'] = [
    { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }
  ]
  XLSX.utils.sheet_add_aoa(
    totalsSheet,
    [
      [],
      ['La venta del negocio es el renglón "Ventas emitidas".'],
      ['Las anuladas salen en las demás hojas (columna Estado) pero no son venta.'],
      ['El IVA es informativo: se calcula al 16% y no está guardado en el sistema.']
    ],
    { origin: -1 }
  )
  XLSX.utils.book_append_sheet(workbook, totalsSheet, 'Resumen')

  const summarySheet = XLSX.utils.json_to_sheet(salesToSheet(sales))
  // Folio, Fecha, Sucursal, Cliente, Kits, Líneas, Subtotal, Desc. %,
  // Descuento, Total, IVA (16%), Total con IVA, Canal, Estado, Pagado, Saldo,
  // Estado de pago, Creó
  summarySheet['!cols'] = [
    { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 22 }, { wch: 7 },
    { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
    { wch: 12 }, { wch: 14 }, { wch: 18 }
  ]
  addAutofilter(summarySheet)
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ventas')

  const itemsSheet = XLSX.utils.json_to_sheet(saleItemsToSheet(sales))
  // Folio, Fecha, Sucursal, Cliente, Tipo, Kit, SKU kit, Cant. kits,
  // Producto, SKU, Cantidad, P. unit., Total línea, Desc. %, Total c/desc., Estado
  itemsSheet['!cols'] = [
    { wch: 12 }, { wch: 18 }, { wch: 10 }, { wch: 22 }, { wch: 8 },
    { wch: 25 }, { wch: 14 }, { wch: 10 }, { wch: 25 }, { wch: 12 },
    { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 10 }
  ]
  addAutofilter(itemsSheet)
  XLSX.utils.book_append_sheet(workbook, itemsSheet, 'Detalle de tickets')

  const fecha = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `${filenamePrefix}_${fecha}.xlsx`)
}

async function exportFiltered() {
  exportingFiltered.value = true
  try {
    const rows = await fetchAllSales({
      status: status.value,
      storeId: storeId.value,
      productId: productId.value,
      from: from.value,
      to: to.value,
      q: search.value
    })
    if (!rows.length) {
      toast.add({ title: 'Sin datos para exportar', color: 'warning', icon: 'i-lucide-info' })
      return
    }

    downloadSalesWorkbook(rows, 'ventas-filtradas')
  } catch (e) {
    toast.add({
      title: 'No se pudo exportar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    exportingFiltered.value = false
  }
}

async function exportAll() {
  exportingAll.value = true
  try {
    // Igual que exportFiltered pero SIN el filtro de estado: sale todo.
    const rows = await fetchAllSales({
      storeId: storeId.value,
      productId: productId.value,
      from: from.value,
      to: to.value,
      q: search.value
    })
    if (!rows.length) {
      toast.add({ title: 'Sin datos para exportar', color: 'warning', icon: 'i-lucide-info' })
      return
    }

    downloadSalesWorkbook(rows, 'ventas-con-desglose')
  } catch (e) {
    toast.add({
      title: 'No se pudo exportar',
      description: apiErrorMessage(e),
      color: 'error',
      icon: 'i-lucide-triangle-alert'
    })
  } finally {
    exportingAll.value = false
  }
}

// La tasa vive en `utils/iva.ts`; esta pantalla tenía su propia copia.
const detailIva = computed(() => (detail.value ? ivaOf(Number(detail.value.totalAmount)) : 0))

// ───────────────────────────────────────────────
//  SUMATORIA DEL FILTRO (tarjetas)
// ───────────────────────────────────────────────
// ⚠️ `totals` lo calcula el SERVIDOR sobre todo el filtro. Sumar `sales` daría
// el total de la página visible (100 filas) y cambiaría al paginar.
const ivaTotal = computed(() => ivaOf(totals.value.issuedAmount))
const totalWithIva = computed(() => totals.value.issuedAmount + ivaTotal.value)

const totalHint = computed(() => {
  const n = totals.value.issuedCount
  const base = `${n} venta${n === 1 ? '' : 's'} emitida${n === 1 ? '' : 's'} · sin IVA`
  if (!totals.value.voidedCount) return base
  // Las anuladas no son venta, pero esconderlas haría que la tarjeta no
  // cuadrara con el listado (que sí las muestra).
  const v = totals.value.voidedCount
  return `${base} · ${v} anulada${v === 1 ? '' : 's'} fuera (${currency.format(totals.value.voidedAmount)})`
})

// ───────────────────────────────────────────────
//  TICKET: agrupar las líneas por kit
// ───────────────────────────────────────────────
// La agrupación vive en ~/utils/ticket porque TicketVenta.vue (el ticket
// impreso) necesita exactamente la misma: lo que se ve en el modal y lo que
// sale por la impresora tienen que coincidir renglón por renglón.
const detailGroups = computed<TicketGroup[]>(() => groupSaleItemsByKit(detail.value?.items ?? []))

/** Factor del descuento de la venta (1 = sin descuento). Se aplica igual a
 *  todas las líneas, así que un kit se descuenta completo. */
const detailDiscountFactor = computed(
  () => 1 - Number(detail.value?.discountPct ?? 0) / 100
)

const route = useRoute()

// ─── Filtros que llegan por la URL (enlaces del dashboard) ───
// `search` y `productId` viven en `useState`, así que sobreviven a la
// navegación: al entrar por un enlace hay que limpiar el OTRO filtro o el que
// quedó de la visita anterior sigue aplicándose y la lista sale casi vacía
// (p. ej. "ventas del producto X" + "ventas del cliente Y" a la vez).
const queryProductId = Number(route.query.productId)
const querySearch = String(route.query.q ?? '').trim()

if (Number.isFinite(queryProductId) && queryProductId > 0) {
  productId.value = queryProductId
  search.value = ''
} else if (querySearch) {
  search.value = querySearch
  productId.value = undefined
}

</script>

<template>
  <UContainer class="py-8 space-y-6">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Historial de ventas</h1>
        <p class="text-sm text-muted">
          {{ sales.length }} venta(s)
          <template v-if="!seesAllStores"> · tu sucursal</template>
        </p>
      </div>
        <div class="flex flex-wrap gap-2">

      <UButton v-if="canWrite" to="/ventas/nueva" icon="i-lucide-plus" color="primary"> Nueva venta </UButton>
      <UButton
      icon="i-lucide-file-spreadsheet"
      color="neutral"
      variant="subtle"
      :loading="exportingAll"
      @click="exportAll"
    >
      Exportar todo
    </UButton>
     <UButton
    icon="i-lucide-file-spreadsheet"
    color="neutral"
    variant="subtle"
    :loading="exportingFiltered"
    @click="exportFiltered"
  >
    Exportar con filtro
  </UButton>
        </div>
    </header>

    <div class="space-y-3">
      <FiltroPeriodo
        v-model:search="search"
        v-model:from="from"
        v-model:to="to"
        :search-placeholder="'Buscar folio, sucursal, empleado, método de pago…'"
      />
      <div class="flex flex-wrap gap-3">
        <USelect v-model="status" :items="statusItems" class="w-44" />
        <USelect v-if="seesAllStores" v-model="storeFilter" :items="storeItems" class="w-60" />
         <USelectMenu
      v-model="productId"
      :items="productItems"
      value-key="value"
      searchable
      placeholder="Buscar producto…"
      class="w-64"
    />
      </div>
    </div>

    <!-- Sumatoria del filtro completo (la calcula el servidor, no la página). -->
    <div class="grid gap-3 sm:grid-cols-2">
      <TarjetaTotal
        label="Total vendido"
        icon="i-lucide-receipt"
        tone="success"
        :amount="totals.issuedAmount"
        :hint="totalHint"
        :loading="pending"
      />
      <TarjetaTotal
        label="IVA (16%) · informativo"
        icon="i-lucide-percent"
        :amount="ivaTotal"
        :hint="`Total con IVA ${currency.format(totalWithIva)}`"
        :loading="pending"
      />
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="No se pudo cargar el historial"
      :description="error"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-muted border-b border-default">
            <tr class="text-left">
              <th class="px-4 py-3 font-medium">Folio</th>
              <th class="px-4 py-3 font-medium">Sucursal</th>
              <th class="px-4 py-3 font-medium">Cliente</th>
              <th class="px-4 py-3 font-medium">Fecha</th>
              <th class="px-4 py-3 font-medium text-right">Prod.</th>
              <th class="px-4 py-3 font-medium text-right">Total</th>
              <th class="px-4 py-3 font-medium text-right">Total con IVA</th>
              <th class="px-4 py-3 font-medium text-center">Canal</th>
              <th class="px-4 py-3 font-medium text-center">Estado</th>
              <th class="px-4 py-3 font-medium">Pago</th>
              <th class="px-4 py-3 font-medium">Creó</th>
              <th class="px-4 py-3 font-medium text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-if="pending">
              <td :colspan="12" class="px-4 py-8 text-center text-muted">Cargando…</td>
            </tr>
            <tr v-else-if="!sales.length">
              <td :colspan="12" class="px-4 py-8 text-center text-muted">
                Sin ventas para el filtro actual.
              </td>
            </tr>
            <template v-for="s in sales" v-else :key="s.id">
              <tr class="hover:bg-elevated/50">
                <td class="px-4 py-3 font-mono text-xs">{{ s.folio }}</td>
                <td class="px-4 py-3 text-muted">{{ s.storeCode ?? '—' }}</td>
                <td class="px-4 py-3 text-muted">{{ s.customerName ?? 'Sin cliente' }}</td>
                <td class="px-4 py-3 text-muted whitespace-nowrap">{{ fmtDate(s.issuedAt) }}</td>
                <td class="px-4 py-3 text-right tabular-nums">{{ s.itemCount }}</td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ currency.format(Number(s.totalAmount)) }}
                </td>
                <td class="px-4 py-3 text-right tabular-nums">
                  {{ currency.format(Number(s.totalAmount) + ivaOf(Number(s.totalAmount))) }}
                </td>
                <td class="px-4 py-3 text-center">
                  <UBadge
                    :label="s.channel === 'en_linea' ? 'En línea' : 'Mostrador'"
                    :color="s.channel === 'en_linea' ? 'info' : 'neutral'"
                    variant="subtle"
                  />
                </td>
                <td class="px-4 py-3 text-center">
                  <UBadge
                    :label="s.status === 'anulada' ? 'Anulada' : 'Emitida'"
                    :color="s.status === 'anulada' ? 'error' : 'success'"
                    variant="subtle"
                  />
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2 whitespace-nowrap">
                    <UBadge
                      :label="SALE_PAYMENT_STATUS_LABELS[s.paymentStatus]"
                      :color="PAYMENT_STATUS_COLORS[s.paymentStatus]"
                      variant="subtle"
                    />
                    <span v-if="s.paymentStatus === 'parcial'" class="text-xs text-muted tabular-nums">
                      resta {{ currency.format(s.balance) }}
                    </span>
                    <!-- Va aquí y no en "Acciones" porque ahí solo hay anulación
                         (admin) o solicitud de corrección; cobrar lo hace
                         cualquiera que pueda escribir. -->
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-wallet"
                      :title="s.status === 'anulada' ? 'Venta anulada' : 'Ver pagos'"
                      @click="openPayments(s)"
                    />
                  </div>
                </td>
                <td class="px-4 py-3 text-muted">{{ s.createdByName ?? '—' }}</td>
                <td class="px-4 py-3 text-right">
                   <div class="flex items-center justify-end gap-1">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-receipt"
                      @click="openDetail(s)"
                    />
                  <!-- Admin: anula directo -->
                  <UButton
                    v-if="isAdmin && s.status === 'emitida' && voidingId !== s.id"
                    size="xs"
                    color="error"
                    variant="ghost"
                    icon="i-lucide-ban"
                    @click="openVoid(s)"
                  >
                    Anular
                  </UButton>
                  <!-- Empleado: ya hay un ticket abierto para esta venta -->
                  <UBadge
                    v-else-if="!isAdmin && s.status === 'emitida' && s.pendingCorrection"
                    label="Esperando corrección"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-clock"
                  />
                  <!-- Empleado: solicita anulación (abre ticket). canWrite deja
                       fuera al observador, que solo consulta. -->
                  <UButton
                    v-else-if="canWrite && !isAdmin && s.status === 'emitida' && requestingId !== s.id"
                    size="xs"
                    color="warning"
                    variant="ghost"
                    icon="i-lucide-flag"
                    @click="openRequest(s)"
                  >
                    Solicitar anulación
                  </UButton>
                  <span v-else-if="s.status === 'anulada'" class="text-xs text-muted">—</span>
                </div>
                </td>
              </tr>
              <!-- Panel: empleado solicita anulación (abre ticket) -->
              <tr v-if="!isAdmin && requestingId === s.id" class="bg-elevated/40">
                <td :colspan="12" class="px-4 py-3">
                  <div class="flex flex-wrap items-start gap-3">
                    <div class="flex-1">
                      <p class="text-xs text-muted mb-1">
                        Solicitar anulación para <strong>{{ s.folio }}</strong>
                      </p>
                      <UInput
                        v-model="requestReason"
                        placeholder="Motivo de la anulación…"
                        class="max-w-md"
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <UButton
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        :disabled="submittingRequest"
                        @click="cancelRequest"
                      >
                        Cancelar
                      </UButton>
                      <UButton
                        size="xs"
                        color="warning"
                        :loading="submittingRequest"
                        @click="confirmRequest(s)"
                      >
                        Enviar solicitud
                      </UButton>
                    </div>
                  </div>
                </td>
              </tr>
              <!-- Panel de confirmación de anulación (admin) -->
              <tr v-if="isAdmin && voidingId === s.id" class="bg-elevated/40">
                <td :colspan="12" class="px-4 py-3">
                  <div class="flex flex-wrap items-start gap-3">
                    <div class="flex-1">
                      <p class="text-xs text-muted mb-1">
                        Anular <strong>{{ s.folio }}</strong>
                      </p>
                      <UInput
                        v-model="voidReason"
                        placeholder="Motivo (opcional)…"
                        class="max-w-md"
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <UButton
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        :disabled="submittingVoid"
                        @click="cancelVoid"
                      >
                        Cancelar
                      </UButton>
                      <UButton
                        size="xs"
                        color="error"
                        :loading="submittingVoid"
                        @click="confirmVoid(s)"
                      >
                        Confirmar anulación
                      </UButton>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
       
      </div>
    </UCard>
     <div class="flex flex-col items-center gap-2">
          <p class="text-xs text-muted">Mostrando {{ sales.length }} de {{ total }} venta(s)</p>
          <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" />
        </div>

    <!--
      Fix aplicado: el modal ahora limita su altura al viewport y hace scroll
      SOLO en el body (:ui="{ body: 'max-h-[70vh] overflow-y-auto' }').
      El header y el footer (botón Cerrar) quedan siempre visibles, sin
      importar la resolución o el zoom de la pantalla del usuario.
    -->
    <UModal v-model:open="showDetailModal">
      <template #content>
        <UCard :ui="{ body: 'max-h-[70vh] overflow-y-auto' }">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-receipt" class="size-5 text-primary" />
              <h2 class="font-semibold font-mono">{{ detail?.folio ?? '' }}</h2>
              <UBadge
                v-if="detail"
                :label="detail.status === 'anulada' ? 'Anulada' : 'Emitida'"
                :color="detail.status === 'anulada' ? 'error' : 'success'"
                variant="subtle"
                class="ml-auto"
              />
            </div>
          </template>

          <p v-if="loadingDetail" class="text-sm text-muted py-8 text-center">Cargando…</p>

          <div v-else-if="detail" class="space-y-4">
            <!-- Datos generales -->
            <div class="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <p class="text-muted">Sucursal</p>
                <p class="font-medium">{{ detail.storeCode }} · {{ detail.storeName }}</p>
              </div>
              <div>
                <p class="text-muted">Fecha</p>
                <p class="font-medium">{{ fmtDate(detail.issuedAt) }}</p>
              </div>
              <div>
                <p class="text-muted">Cliente</p>
                <p class="font-medium">{{ detail.customerName ?? 'Sin cliente' }}</p>
              </div>
              <div>
                <p class="text-muted">Canal</p>
                <p class="font-medium">{{ detail.channel === 'en_linea' ? 'En línea' : 'Mostrador' }}</p>
              </div>
              <div>
                <p class="text-muted">Método de pago</p>
                <p class="font-medium">{{ PAYMENT_LABELS[detail.paymentMethod] }}</p>
              </div>
              <div>
                <p class="text-muted">Vendió</p>
                <p class="font-medium">{{ detail.createdByName ?? '—' }}</p>
              </div>
            </div>

            <p v-if="detail.note" class="text-sm text-muted italic">"{{ detail.note }}"</p>

            <USeparator />

            <!-- Líneas de producto -->
            <div class="max-h-72 overflow-y-auto">
              <table class="w-full text-sm">
                <thead class="text-muted border-b border-default sticky top-0 bg-default">
                  <tr class="text-left">
                    <th class="py-2 font-medium">Producto</th>
                    <th class="py-2 font-medium text-right">Cant.</th>
                    <th class="py-2 font-medium text-right">P. unit.</th>
                    <th class="py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <template v-for="g in detailGroups" :key="g.key">
                    <!-- Cabecera del kit -->
                    <tr v-if="g.kitId !== null" class="bg-elevated/40">
                      <td class="py-2">
                        <div class="flex items-center gap-2">
                          <UIcon name="i-lucide-boxes" class="size-4 text-primary shrink-0" />
                          <div>
                            <p class="font-medium">{{ g.kitName ?? 'Kit' }}</p>
                            <p class="text-xs text-muted font-mono">{{ g.kitSku ?? '—' }}</p>
                          </div>
                        </div>
                      </td>
                      <td class="py-2 text-right tabular-nums">{{ g.kitQuantity }}</td>
                      <td class="py-2 text-right text-xs text-muted">kit</td>
                      <td class="py-2 text-right tabular-nums font-medium">
                        {{ currency.format(g.subtotal) }}
                      </td>
                    </tr>

                    <!-- Líneas: productos del kit (indentados) o producto suelto -->
                    <tr v-for="it in g.items" :key="it.id">
                      <td :class="g.kitId !== null ? 'py-1 pl-6' : 'py-2'">
                        <p
                          :class="g.kitId !== null ? 'text-xs' : 'font-medium'"
                          class="flex items-center gap-2"
                        >
                          {{ it.productName ?? '—' }}
                          <!-- La muestra salió del mismo producto y a precio 0:
                               sin la marca, la línea parece un regalo sin motivo. -->
                          <UBadge
                            v-if="it.sampleProductId !== null"
                            color="warning"
                            variant="subtle"
                            size="sm"
                          >
                            Muestra
                          </UBadge>
                        </p>
                        <p class="text-xs text-muted font-mono">
                          {{ it.productSku ?? '—' }}
                          <template v-if="it.sampleSku"> · {{ it.sampleSku }}</template>
                        </p>
                      </td>
                      <td
                        class="text-right tabular-nums"
                        :class="g.kitId !== null ? 'py-1 text-xs' : 'py-2'"
                      >
                        {{ it.quantity }}
                      </td>
                      <td
                        class="text-right tabular-nums"
                        :class="g.kitId !== null ? 'py-1 text-xs' : 'py-2'"
                      >
                        {{ currency.format(Number(it.unitPrice)) }}
                      </td>
                      <td
                        class="text-right tabular-nums"
                        :class="g.kitId !== null ? 'py-1 text-xs text-muted' : 'py-2'"
                      >
                        {{ currency.format(Number(it.lineTotal)) }}
                      </td>
                    </tr>

                    <!-- El descuento de la venta aplica al kit completo -->
                    <tr v-if="g.kitId !== null && detailDiscountFactor < 1">
                      <td colspan="3" class="py-1 pl-6 text-xs text-muted">
                        Kit con {{ Number(detail.discountPct) }}% de descuento
                      </td>
                      <td class="py-1 text-right tabular-nums text-xs font-medium">
                        {{ currency.format(g.subtotal * detailDiscountFactor) }}
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>

            <USeparator />

            <div class="flex justify-between text-lg font-semibold">
              <span>Total</span>
              <span class="tabular-nums">{{ currency.format(Number(detail.totalAmount)) }}</span>
            </div>
            <div class="flex justify-between text-xs text-muted">
              <span>IVA (16%) · informativo</span>
              <span class="tabular-nums">{{ currency.format(detailIva) }}</span>
            </div>
            <div class="flex justify-between text-xs text-muted">
              <span>Total con IVA</span>
              <span class="tabular-nums">{{ currency.format(detailIva + Number(detail.totalAmount)) }}</span>
            </div>
            <div class="space-y-1 text-sm">
              <div v-if="Number(detail.discountAmount) > 0" class="flex justify-between text-muted">
                <span>Subtotal</span>
                <span class="tabular-nums">{{ currency.format(Number(detail.subtotalAmount)) }}</span>
              </div>
              <div v-if="Number(detail.discountAmount) > 0" class="flex justify-between text-muted">
                <span>Descuento ({{ Number(detail.discountPct) }}%)</span>
                <span class="tabular-nums">-{{ currency.format(Number(detail.discountAmount)) }}</span>
              </div>
            </div>

            <UAlert
              v-if="detail.status === 'anulada'"
              color="error"
              variant="soft"
              icon="i-lucide-ban"
              title="Venta anulada"
              :description="detail.voidReason ?? undefined"
            />
          </div>

          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" color="neutral" @click="showDetailModal = false">Cerrar</UButton>
              <UButton
                v-if="detail"
                icon="i-lucide-file-down"
                color="primary"
                :loading="downloadingTicket"
                @click="downloadTicket"
              >
                Descargar PDF
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <!-- Pagos de la venta -->
    <UModal v-model:open="showPaymentsModal">
      <template #content>
        <UCard :ui="{ body: 'max-h-[75vh] overflow-y-auto' }">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-wallet" class="size-5 text-primary" />
              <div class="leading-tight">
                <h2 class="font-semibold font-mono">{{ viewingSale?.folio ?? 'Venta' }}</h2>
                <p class="text-xs text-muted">
                  {{ viewingSale?.customerName ?? 'Sin cliente' }}
                </p>
              </div>
              <UBadge
                v-if="viewingSale"
                :label="SALE_PAYMENT_STATUS_LABELS[viewingSale.paymentStatus]"
                :color="PAYMENT_STATUS_COLORS[viewingSale.paymentStatus]"
                variant="subtle"
                class="ml-auto"
              />
            </div>
          </template>

          <div v-if="viewingSale" class="space-y-5">
            <!-- Datos de la venta -->
            <div class="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <p class="text-muted text-xs">Sucursal</p>
                <p class="font-medium">{{ viewingSale.storeCode ?? '—' }}</p>
              </div>
              <div>
                <p class="text-muted text-xs">Fecha</p>
                <p class="font-medium">{{ fmtDate(viewingSale.issuedAt) }}</p>
              </div>
              <div>
                <p class="text-muted text-xs">Método de la venta</p>
                <p class="font-medium">{{ PAYMENT_LABELS[viewingSale.paymentMethod] }}</p>
              </div>
              <div>
                <p class="text-muted text-xs">Vendió</p>
                <p class="font-medium">{{ viewingSale.createdByName ?? '—' }}</p>
              </div>
            </div>

            <USeparator />

            <!-- Resumen de cobro -->
            <div class="grid gap-3 sm:grid-cols-3 text-sm rounded-lg bg-elevated/40 px-4 py-3">
              <div>
                <p class="text-muted text-xs">Total a cobrar</p>
                <p class="font-medium tabular-nums">
                  {{ currency.format(viewingSale.totalToPay) }}
                </p>
              </div>
              <div>
                <p class="text-muted text-xs">Cobrado</p>
                <p class="font-medium tabular-nums text-success">
                  {{ currency.format(viewingSale.totalPaid) }}
                </p>
              </div>
              <div>
                <p class="text-muted text-xs">Saldo pendiente</p>
                <p class="font-medium tabular-nums text-error">
                  {{ currency.format(viewingSale.balance) }}
                </p>
              </div>
            </div>
            <p class="text-xs text-muted">
              El total es el de la venta, con el descuento ya aplicado y sin IVA.
            </p>

            <AsignarCuentaPagos
              v-if="viewingSale"
              :endpoint="`/api/sales/${viewingSale.id}`"
              :bank-payment-count="bankPaymentCount"
              :assigned-count="assignedAccountCount"
              @done="refreshPayments"
            />

            <!-- Historial de pagos -->
            <div>
              <h3 class="text-sm font-semibold mb-2">Historial de pagos</h3>
              <p v-if="loadingPayments" class="text-sm text-muted py-4 text-center">Cargando…</p>
              <p v-else-if="!payments.length" class="text-sm text-muted py-4 text-center">
                Sin pagos registrados todavía.
              </p>
              <ul v-else class="divide-y divide-default text-sm">
                <li v-for="p in payments" :key="p.id" class="py-2">
                  <p class="font-medium tabular-nums">{{ currency.format(Number(p.amount)) }}</p>
                  <p class="text-xs text-muted">
                    {{ fmtDay(p.paidAt) }} · {{ PAYMENT_LABELS[p.method] }}
                    <span v-if="p.createdByName"> · {{ p.createdByName }}</span>
                    <span v-if="p.accountLabel"> · {{ p.accountLabel }}</span>
                    <span v-else-if="p.method !== 'efectivo'" class="text-warning">
                      · sin cuenta
                    </span>
                  </p>
                  <p v-if="p.note" class="text-xs text-muted italic">"{{ p.note }}"</p>
                </li>
              </ul>
            </div>

            <!-- Una venta anulada no se cobra: la anulación ya borró sus pagos. -->
            <UAlert
              v-if="viewingSale.status === 'anulada'"
              color="neutral"
              variant="soft"
              icon="i-lucide-ban"
              title="Venta anulada"
              description="La mercancía volvió al inventario, así que no hay nada que cobrar."
            />

            <template v-else-if="canWrite && viewingSale.balance > 0">
              <USeparator />

              <!-- Alta de pago (el observador solo ve el historial) -->
              <div class="space-y-3">
                <h3 class="text-sm font-semibold">Registrar pago</h3>
                <div class="grid gap-3 sm:grid-cols-2">
                  <UFormField label="Monto">
                    <UInputNumber
                      v-model="paymentForm.amount"
                      :min="0"
                      :max="viewingSale.balance"
                      :step="0.01"
                      :format-options="{ minimumFractionDigits: 0, maximumFractionDigits: 2 }"
                      :placeholder="`máx. ${viewingSale.balance.toFixed(2)}`"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="Fecha de pago">
                    <UInput v-model="paymentForm.paidAt" type="date" class="w-full" />
                  </UFormField>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <UFormField label="Método">
                    <USelect v-model="paymentForm.method" :items="paymentMethodItems" class="w-full" />
                  </UFormField>
                  <SelectorCuentaPago
                    v-model="paymentForm.accountId"
                    :method="paymentForm.method"
                  />
                </div>
                <div class="grid gap-3">
                  <UFormField label="Nota (opcional)">
                    <UInput v-model="paymentForm.note" placeholder="Referencia, folio…" class="w-full" />
                  </UFormField>
                </div>
                <div class="flex justify-end">
                  <UButton
                    icon="i-lucide-plus"
                    color="primary"
                    :loading="submittingPayment"
                    :disabled="!canSubmitPayment"
                    @click="submitPayment"
                  >
                    Agregar pago
                  </UButton>
                </div>
              </div>
            </template>

            <!-- Saldo 0: cobrada, o una venta de $0 (muestras / 100% descuento),
                 que nace pagada porque no hay nada que cobrar. -->
            <UAlert
              v-else-if="viewingSale.balance <= 0"
              color="success"
              variant="soft"
              icon="i-lucide-circle-check"
              :title="
                viewingSale.totalToPay <= 0
                  ? 'Venta sin importe que cobrar'
                  : 'Venta completamente pagada'
              "
              :description="
                viewingSale.totalToPay <= 0
                  ? 'El total es $0.00: se entregó como muestra o con descuento total.'
                  : undefined
              "
            />
          </div>

          <div class="flex justify-end pt-4">
            <UButton variant="ghost" color="neutral" @click="showPaymentsModal = false">
              Cerrar
            </UButton>
          </div>
        </UCard>
      </template>
    </UModal>
  </UContainer>
</template>