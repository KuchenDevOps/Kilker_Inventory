// utils/banksMovementsPdf.ts — el libro de dinero filtrado como documento pdfmake
//
// Es la exportación de /cuentas/movimientos: las mismas filas que muestra la
// tabla, con su SALDO CORRIDO, en el formato de un estado de cuenta.
//
// Tamaño carta APAISADO: son siete columnas (fecha, concepto, bolsa, nota,
// sucursal, importe y saldo) y en vertical la nota y el concepto quedan en
// cuatro renglones cada uno. El ticket de venta (utils/ticketPdf.ts) sí va
// vertical porque son cuatro columnas.
//
// ⚠️ Las filas se imprimen de la MÁS VIEJA A LA MÁS NUEVA, al revés que la
// pantalla. No es una inconsistencia: la columna de saldo sólo se lee hacia
// abajo si el tiempo avanza hacia abajo, que es como está hecho cualquier estado
// de cuenta. En pantalla manda lo contrario (lo último capturado, arriba).
//
// ⚠️ El `balance` de cada fila lo calcula el SERVIDOR sobre todo el libro; aquí
// no se acumula nada. Reconstruirlo sumando los importes visibles daría otro
// número en cuanto haya un filtro puesto, porque el saldo cuenta también los
// movimientos que el filtro escondió (ver `GET /api/banks-movements`).
//
// ⚠️ Los movimientos REVERTIDOS (`reversedById`) se imprimen marcados "ANULADO"
// y con el importe tachado, igual que el badge rojo de la pantalla. Marcar no es
// descontar: ni el saldo ni las cifras de arriba cambian, porque la reversa es
// otra fila del mismo libro y ya está contada.
import type { PdfContent, PdfDocDefinition } from 'pdfmake/build/pdfmake'
import type { ApiBanksMovement } from '~/types/inventario'
import { CASH_FLOW_LABELS, PAYMENT_LABELS } from '~/types/inventario'

const INK = '#111827'
const MUTED = '#5b655f'
/** Gris de los renglones alternos. */
const ZEBRA = '#eef1ee'
const RULE = '#d4d8d4'
const SUCCESS = '#15803d'
const ERROR = '#b91c1c'

const currencyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const money = (n: number) => currencyFmt.format(n)

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * Formatea una columna `date` (`YYYY-MM-DD`) SIN pasar por `new Date()`.
 *
 * ⚠️ Mismo motivo que en la pantalla: `new Date('2026-08-30')` es medianoche UTC,
 * que en México es todavía el 29, y la fecha saldría un día antes de la
 * capturada.
 */
export function fmtLedgerDate(s: string | null | undefined) {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return '—'
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

function fmtStamp(d: Date) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

export interface BanksMovementsReportMeta {
  /**
   * Qué universo cubre la columna de saldo: la bolsa filtrada, o todas juntas.
   * Va impreso porque un saldo corrido sobre varias bolsas es la suma de todas
   * y no el saldo de ninguna en particular.
   */
  balanceScope: string
  /** Filtros vigentes ya resueltos a texto, para el renglón gris del encabezado. */
  filters: string[]
  generatedAt: Date
}

/** El concepto que se muestra: el texto libre, o la etiqueta de la clasificación. */
function conceptOf(m: ApiBanksMovement) {
  return m.concept ?? CASH_FLOW_LABELS[m.type]
}

/**
 * Si el movimiento FUE revertido (`reversedById`), o sea que su importe ya no
 * cuenta.
 *
 * ⚠️ El libro es append-only: la fila revertida no se borra, se queda con su
 * `anulacion` al lado. Sin marcarla, el PDF la imprimía idéntica a las vivas y
 * se leía como dinero que entró — justo lo que en la pantalla evita el badge
 * rojo "Anulado".
 *
 * La marca es la PALABRA "ANULADO" y el tachado del importe, no el color:
 * impreso en blanco y negro (o fotocopiado) el rojo es un gris más.
 */
function isVoided(m: ApiBanksMovement) {
  return m.reversedById != null
}

/** Encabezado de columna. */
function th(text: string, alignment: 'left' | 'right' = 'left'): PdfContent {
  return { text, alignment, fontSize: 7, bold: true, color: MUTED }
}

/** Una cifra del bloque de arriba: etiqueta chica en mayúsculas, valor grande. */
function kpi(label: string, value: string, color = INK): PdfContent {
  return {
    stack: [
      { text: label.toUpperCase(), fontSize: 6.5, color: MUTED, characterSpacing: 0.4 },
      { text: value, fontSize: 12, bold: true, color, margin: [0, 2, 0, 0] }
    ]
  }
}

/** Tabla chica de resumen (por bolsa, por forma de pago). */
function summaryTable(
  title: string,
  rows: { label: string; count: number; total: number }[]
): PdfContent {
  return {
    stack: [
      { text: title, fontSize: 8, bold: true, color: MUTED, margin: [0, 0, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: ['*', 32, 66],
          body: [
            [th('Concepto'), th('Movs.', 'right'), th('Neto', 'right')],
            ...rows.map((r) => [
              { text: r.label, fontSize: 7.5 },
              { text: String(r.count), fontSize: 7.5, alignment: 'right' },
              {
                text: money(r.total),
                fontSize: 7.5,
                alignment: 'right',
                color: r.total < 0 ? ERROR : INK
              }
            ])
          ]
        },
        layout: {
          hLineWidth: (i: number) => (i === 1 ? 1 : 0),
          vLineWidth: () => 0,
          hLineColor: () => INK,
          fillColor: (i: number) => (i > 0 && i % 2 === 0 ? ZEBRA : null),
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 3,
          paddingBottom: () => 3
        }
      }
    ]
  }
}

/** Agrupa por una clave y devuelve movimientos y neto, de mayor a menor neto. */
function groupBy(
  movements: ApiBanksMovement[],
  key: (m: ApiBanksMovement) => string
): { label: string; count: number; total: number }[] {
  const map = new Map<string, { label: string; count: number; total: number }>()
  for (const m of movements) {
    const label = key(m)
    const cur = map.get(label) ?? { label, count: 0, total: 0 }
    cur.count += 1
    cur.total += Number(m.amount)
    map.set(label, cur)
  }
  return [...map.values()]
    .map((r) => ({ ...r, total: Math.round(r.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Arma el documento pdfmake del libro de dinero filtrado. Es sólo la
 * definición: quien la llame carga pdfmake y dispara la descarga.
 *
 * `movements` llega en el orden de la pantalla (lo más nuevo primero); aquí se
 * invierte. `logoDataUrl` es el logotipo ya en data URL (utils/brandLogo.ts),
 * por parámetro y no importado, para que el base64 viaje en el chunk perezoso de
 * pdfmake y no en el bundle de la página.
 */
export function buildBanksMovementsDoc(
  movements: ApiBanksMovement[],
  meta: BanksMovementsReportMeta,
  logoDataUrl: string
): PdfDocDefinition {
  // Cronológico ascendente, con el `id` de desempate: el MISMO orden total con
  // el que el servidor acumuló el saldo. Con otro criterio, la columna de saldo
  // subiría y bajaría sin relación con los importes de al lado.
  const rows = [...movements].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id - b.id
  )

  // ⚠️ Entradas/salidas/neto suman los importes TAL CUAL, anulados incluidos, y
  // así se quedan: tanto el movimiento original como su reversa están dentro del
  // filtro, así que se cancelan solos en el neto. Descontar aquí los marcados
  // ANULADO los restaría dos veces. Es el mismo criterio del `filteredNet` de la
  // pantalla; cambiarlo es una decisión aparte y de los dos lados.
  const inflow = rows.reduce((s, m) => (Number(m.amount) > 0 ? s + Number(m.amount) : s), 0)
  const outflow = rows.reduce((s, m) => (Number(m.amount) < 0 ? s + Number(m.amount) : s), 0)
  const net = Math.round((inflow + outflow) * 100) / 100
  const voidedCount = rows.reduce((n, m) => (isVoided(m) ? n + 1 : n), 0)

  const first = rows[0]
  const last = rows[rows.length - 1]
  // Saldo justo ANTES del primer movimiento listado. Se deriva del saldo que ya
  // trae la fila, no de una petición aparte: `balance` es posterior al
  // movimiento, así que restarle su propio importe da el anterior.
  const opening = first ? Math.round((first.balance - Number(first.amount)) * 100) / 100 : 0
  const closing = last ? last.balance : 0

  const tableBody: PdfContent[][] = [
    [
      th('Fecha'),
      th('Concepto'),
      th('Bolsa'),
      th('Nota'),
      th('Suc.'),
      th('Importe', 'right'),
      th('Saldo', 'right')
    ]
  ]

  for (const m of rows) {
    const amount = Number(m.amount)
    const voided = isVoided(m)
    const sub = [m.method ? PAYMENT_LABELS[m.method] : null, m.createdByName]
      .filter(Boolean)
      .join(' · ')

    tableBody.push([
      { text: fmtLedgerDate(m.occurredAt), fontSize: 7.5, noWrap: true },
      {
        stack: [
          voided
            ? {
                // La palabra va en el mismo renglón del concepto, no debajo:
                // se lee junto con lo que califica y no le agrega alto a la
                // fila (la tabla ya lleva dos renglones por movimiento).
                text: [conceptOf(m), { text: '  ANULADO', bold: true, color: ERROR }],
                fontSize: 7.5
              }
            : { text: conceptOf(m), fontSize: 7.5 },
          ...(sub ? [{ text: sub, fontSize: 6.5, color: MUTED }] : [])
        ]
      },
      { text: m.accountLabel ?? 'Efectivo', fontSize: 7 },
      { text: m.note ?? '—', fontSize: 6.5, color: MUTED },
      { text: m.storeCode ?? '—', fontSize: 6.5, color: MUTED },
      {
        // Tachado y en gris cuando está anulado: el verde/rojo del signo diría
        // "entró"/"salió" de un importe que ya se revirtió.
        text: money(amount),
        fontSize: 7.5,
        alignment: 'right',
        noWrap: true,
        ...(voided ? { decoration: 'lineThrough' } : {}),
        color: voided ? MUTED : amount < 0 ? ERROR : SUCCESS
      },
      {
        text: money(m.balance),
        fontSize: 7.5,
        bold: true,
        alignment: 'right',
        noWrap: true,
        color: m.balance < 0 ? ERROR : INK
      }
    ])
  }

  if (!rows.length) {
    tableBody.push([
      {
        text: 'No hay movimientos con estos filtros.',
        colSpan: 7,
        fontSize: 8,
        color: MUTED,
        alignment: 'center',
        margin: [0, 10, 0, 10]
      },
      {},
      {},
      {},
      {},
      {},
      {}
    ])
  }

  return {
    pageSize: 'LETTER',
    pageOrientation: 'landscape',
    pageMargins: [28, 30, 28, 40],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: INK },
    info: {
      title: 'Movimientos de banco',
      subject: `Libro de dinero · ${meta.balanceScope}`
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: `Generado el ${fmtStamp(meta.generatedAt)} · Inventario Kilker`,
          fontSize: 7,
          color: MUTED
        },
        {
          text: `Página ${currentPage} de ${pageCount}`,
          fontSize: 7,
          color: MUTED,
          alignment: 'right'
        }
      ],
      margin: [28, 12, 28, 0]
    }),
    content: [
      // Encabezado: marca, título y el renglón gris con los filtros aplicados.
      { image: logoDataUrl, width: 96, margin: [0, 0, 0, 6] },
      { text: 'Movimientos de banco', fontSize: 15, bold: true },
      {
        text: meta.filters.join('  ·  '),
        fontSize: 8,
        color: MUTED,
        margin: [0, 3, 0, 0]
      },

      // Cifras del filtro. `Saldo al cierre` es el saldo real después del último
      // movimiento listado, no el saldo de hoy: con un periodo puesto, después
      // de esa fecha puede haber más movimientos.
      {
        table: {
          widths: ['*', '*', '*', '*', '*'],
          body: [
            [
              kpi('Entradas', money(Math.round(inflow * 100) / 100), SUCCESS),
              kpi('Salidas', money(Math.round(outflow * 100) / 100), outflow < 0 ? ERROR : INK),
              kpi('Neto del filtro', money(net), net < 0 ? ERROR : INK),
              kpi('Movimientos', String(rows.length)),
              kpi('Saldo al cierre', money(closing), closing < 0 ? ERROR : INK)
            ]
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => RULE,
          paddingLeft: (i: number) => (i === 0 ? 0 : 8),
          paddingRight: () => 8,
          paddingTop: () => 8,
          paddingBottom: () => 8
        },
        margin: [0, 12, 0, 0]
      },

      // Resúmenes del filtro, uno junto al otro (por bolsa y por forma de pago).
      {
        columns: [
          summaryTable(
            'Por bolsa',
            groupBy(rows, (m) => m.accountLabel ?? 'Efectivo')
          ),
          summaryTable(
            'Por forma de pago',
            groupBy(rows, (m) => (m.method ? PAYMENT_LABELS[m.method] : 'Sin método'))
          )
        ],
        columnGap: 24,
        margin: [0, 14, 0, 0]
      },

      {
        text: 'Movimientos',
        fontSize: 10,
        bold: true,
        margin: [0, 16, 0, 2]
      },
      {
        // El alcance del saldo va impreso: sobre varias bolsas la columna es la
        // suma de todas, que no es el saldo de ninguna cuenta en concreto.
        text:
          `Saldo corrido de ${meta.balanceScope} · saldo antes del primer movimiento listado: ` +
          `${money(opening)} · acumula todo el libro, también lo que el filtro no muestra.`,
        fontSize: 7,
        color: MUTED,
        margin: [0, 0, 0, 6]
      },
      // Qué significa la marca, y por qué las cifras de arriba no la descuentan.
      // Va sólo si hay alguna: un renglón fijo explicando algo que no aparece en
      // la tabla es ruido en el 90% de los libros.
      ...(voidedCount
        ? [
            {
              text:
                `${voidedCount} ${voidedCount === 1 ? 'movimiento marcado' : 'movimientos marcados'} ` +
                'ANULADO (importe tachado): su reversa es otra fila de este mismo libro, así que el ' +
                'saldo y las cifras de arriba ya la cuentan. No los restes.',
              fontSize: 7,
              color: ERROR,
              margin: [0, 0, 0, 6]
            }
          ]
        : []),
      {
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: [54, '*', 104, 118, 24, 62, 68],
          body: tableBody
        },
        layout: {
          hLineWidth: (i: number) => (i === 1 ? 1 : 0),
          vLineWidth: () => 0,
          hLineColor: () => INK,
          fillColor: (i: number) => (i > 0 && i % 2 === 0 ? ZEBRA : null),
          paddingLeft: (i: number) => (i === 0 ? 2 : 4),
          paddingRight: (i: number) => (i === 6 ? 2 : 4),
          paddingTop: () => 4,
          paddingBottom: () => 4
        }
      }
    ]
  }
}
