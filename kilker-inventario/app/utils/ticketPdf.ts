// utils/ticketPdf.ts — el ticket de venta como documento pdfmake
//
// Réplica en PDF del ticket que muestra el modal de detalle en
// pages/ventas/index.vue: mismos bloques, mismo orden y mismos textos. Si se
// toca uno hay que tocar el otro; la agrupación por kits sí es compartida
// (utils/ticket.ts) para que las líneas no se puedan desincronizar.
//
// Tamaño carta, no rollo térmico: la tabla de cuatro columnas y la rejilla de
// datos del modal no caben en 80 mm. Para sacarlo en térmica habría que
// rediseñarlo a una columna, no sólo cambiar `pageSize`.
import type { PdfContent, PdfDocDefinition } from 'pdfmake/build/pdfmake'
import type { ApiSaleDetail } from '~/types/inventario'
import { PAYMENT_LABELS } from '~/types/inventario'
import { groupSaleItemsByKit } from './ticket'

/** El IVA es informativo y se calcula en la app; no vive en la BD. */
const IVA_RATE = 0.16

/** Equivalentes de los tokens de Nuxt UI que usa el modal. */
const MUTED = '#6b7280'
const BORDER = '#e5e7eb'
const KIT_FILL = '#f3f4f6'
const SUCCESS = '#15803d'
const ERROR = '#b91c1c'

const currencyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

const money = (n: number) => currencyFmt.format(n)

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

/** Las cantidades vienen como numeric → string ("2.000"); los ceros de
 *  relleno sólo hacen ruido en el PDF. */
function fmtQty(q: string | number | null) {
  const n = Number(q)
  return Number.isFinite(n) ? String(n) : '—'
}

/** Celda de la rejilla de datos: etiqueta gris arriba, valor debajo. */
function field(label: string, value: string): PdfContent {
  return {
    stack: [
      { text: label, fontSize: 8, color: MUTED },
      { text: value, fontSize: 10 }
    ],
    margin: [0, 0, 0, 8]
  }
}

/** Encabezado de la tabla de líneas. */
function th(text: string, alignment: 'left' | 'right' = 'left'): PdfContent {
  return { text, alignment, fontSize: 8, color: MUTED, bold: true }
}

/** Renglón del bloque de totales: concepto a la izquierda, importe a la derecha. */
function sumRow(
  label: string,
  value: string,
  opts: { fontSize?: number; bold?: boolean; color?: string } = {}
): PdfContent {
  const style = { fontSize: opts.fontSize ?? 9, bold: opts.bold ?? false, color: opts.color }
  return {
    columns: [
      { text: label, width: '*', ...style },
      { text: value, width: 'auto', alignment: 'right', ...style }
    ],
    columnGap: 12,
    margin: [0, 0, 0, 3]
  }
}

/** Línea horizontal de ancho completo (el <USeparator /> del modal). */
function separator(gapTop = 10, gapBottom = 10): PdfContent {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: BORDER }],
    margin: [0, gapTop, 0, gapBottom]
  }
}

/**
 * Arma el documento pdfmake del ticket de una venta. Es sólo la definición:
 * quien la llame se encarga de cargar pdfmake y descargar el archivo.
 *
 * `logoDataUrl` es el logotipo de marca (utils/brandLogo.ts) ya en data URL —
 * lo único que acepta pdfmake en el navegador. Se recibe por parámetro en vez
 * de importarlo aquí porque este módulo sí entra en el bundle de la página:
 * así el base64 viaja con pdfmake en su chunk perezoso.
 */
export function buildSaleTicketDoc(
  sale: ApiSaleDetail,
  logoDataUrl: string
): PdfDocDefinition {
  const groups = groupSaleItemsByKit(sale.items)
  /** Factor del descuento de la venta (1 = sin descuento). Se aplica igual a
   *  todas las líneas, así que un kit se descuenta completo. */
  const discountFactor = 1 - Number(sale.discountPct ?? 0) / 100
  const hasDiscount = Number(sale.discountAmount) > 0
  const iva = Number(sale.totalAmount) * IVA_RATE
  const isVoided = sale.status === 'anulada'

  // Tabla de líneas: el kit va como renglón sombreado con su nombre y SKU, y
  // debajo sus componentes indentados, igual que en el modal.
  const tableBody: PdfContent[][] = [
    [th('Producto'), th('Cant.', 'right'), th('P. unit.', 'right'), th('Total', 'right')]
  ]

  for (const g of groups) {
    const inKit = g.kitId !== null

    if (inKit) {
      tableBody.push([
        {
          stack: [
            { text: g.kitName ?? 'Kit', bold: true, fontSize: 9 },
            { text: g.kitSku ?? '—', fontSize: 7, color: MUTED }
          ],
          fillColor: KIT_FILL
        },
        { text: String(g.kitQuantity), alignment: 'right', fontSize: 9, fillColor: KIT_FILL },
        { text: 'kit', alignment: 'right', fontSize: 7, color: MUTED, fillColor: KIT_FILL },
        {
          text: money(g.subtotal),
          alignment: 'right',
          bold: true,
          fontSize: 9,
          fillColor: KIT_FILL
        }
      ])
    }

    for (const it of g.items) {
      const size = inKit ? 8 : 9
      tableBody.push([
        {
          stack: [
            { text: it.productName ?? '—', bold: !inKit, fontSize: size },
            { text: it.productSku ?? '—', fontSize: 7, color: MUTED }
          ],
          margin: inKit ? [12, 0, 0, 0] : [0, 0, 0, 0]
        },
        { text: fmtQty(it.quantity), alignment: 'right', fontSize: size },
        { text: money(Number(it.unitPrice)), alignment: 'right', fontSize: size },
        {
          text: money(Number(it.lineTotal)),
          alignment: 'right',
          fontSize: size,
          color: inKit ? MUTED : undefined
        }
      ])
    }

    // El descuento de la venta aplica al kit completo.
    if (inKit && discountFactor < 1) {
      tableBody.push([
        {
          text: `Kit con ${Number(sale.discountPct)}% de descuento`,
          colSpan: 3,
          fontSize: 8,
          color: MUTED,
          margin: [12, 0, 0, 0]
        },
        {},
        {},
        {
          text: money(g.subtotal * discountFactor),
          alignment: 'right',
          fontSize: 8,
          bold: true
        }
      ])
    }
  }

  return {
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#111827' },
    info: {
      title: `Ticket ${sale.folio}`,
      subject: `Venta ${sale.folio} · ${sale.storeName ?? ''}`
    },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: 'Este comprobante no es un CFDI.', fontSize: 7, color: MUTED },
        { text: `${currentPage} / ${pageCount}`, fontSize: 7, color: MUTED, alignment: 'right' }
      ],
      margin: [40, 12, 40, 0]
    }),
    content: [
      // Encabezado: marca a la izquierda, folio y estado a la derecha
      {
        columns: [
          {
            width: '*',
            stack: [
              // Ancho fijo: la altura la deduce pdfmake por la proporción del PNG.
              { image: logoDataUrl, width: 130, margin: [0, 0, 0, 6] },
              { text: 'Ticket de venta', fontSize: 9, color: MUTED }
            ]
          },
          {
            width: 'auto',
            stack: [
              { text: sale.folio, bold: true, fontSize: 14, alignment: 'right' },
              {
                text: isVoided ? 'ANULADA' : 'EMITIDA',
                bold: true,
                fontSize: 9,
                alignment: 'right',
                color: isVoided ? ERROR : SUCCESS
              }
            ]
          }
        ]
      },

      separator(14, 12),

      // Datos generales — la rejilla de dos columnas del modal
      {
        table: {
          widths: ['*', '*'],
          body: [
            [
              field('Sucursal', `${sale.storeCode ?? ''} · ${sale.storeName ?? ''}`),
              field('Fecha', fmtDate(sale.issuedAt))
            ],
            [
              field('Cliente', sale.customerName ?? 'Sin cliente'),
              field('Canal', sale.channel === 'en_linea' ? 'En línea' : 'Mostrador')
            ],
            [
              field('Método de pago', PAYMENT_LABELS[sale.paymentMethod]),
              field('Vendió', sale.createdByName ?? '—')
            ]
          ]
        },
        layout: 'noBorders'
      },

      ...(sale.note
        ? [{ text: `"${sale.note}"`, fontSize: 9, italics: true, color: MUTED }]
        : []),

      separator(6, 10),

      // Líneas
      {
        table: { headerRows: 1, widths: ['*', 40, 70, 70], body: tableBody },
        layout: {
          // Sólo líneas horizontales, como el `divide-y` del modal.
          hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => BORDER,
          paddingLeft: (i: number) => (i === 0 ? 0 : 6),
          paddingRight: (i: number) => (i === 3 ? 0 : 6),
          paddingTop: () => 5,
          paddingBottom: () => 5
        }
      },

      separator(12, 10),

      // Totales: bloque alineado a la derecha
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 230,
            stack: [
              sumRow('Total', money(Number(sale.totalAmount)), { fontSize: 14, bold: true }),
              sumRow('IVA (16%) · informativo', money(iva), { fontSize: 8, color: MUTED }),
              sumRow('Total con IVA', money(Number(sale.totalAmount) + iva), {
                fontSize: 8,
                color: MUTED
              }),
              ...(hasDiscount
                ? [
                    sumRow('Subtotal', money(Number(sale.subtotalAmount)), {
                      fontSize: 9,
                      color: MUTED
                    }),
                    sumRow(
                      `Descuento (${Number(sale.discountPct)}%)`,
                      `-${money(Number(sale.discountAmount))}`,
                      { fontSize: 9, color: MUTED }
                    )
                  ]
                : [])
            ]
          }
        ]
      },

      // Aviso de anulada — el <UAlert> del modal
      ...(isVoided
        ? [
            {
              table: {
                widths: ['*'],
                body: [
                  [
                    {
                      stack: [
                        { text: 'Venta anulada', bold: true, fontSize: 10, color: ERROR },
                        ...(sale.voidReason
                          ? [{ text: sale.voidReason, fontSize: 9, color: ERROR }]
                          : [])
                      ],
                      fillColor: '#fef2f2',
                      margin: [8, 6, 8, 6]
                    }
                  ]
                ]
              },
              layout: 'noBorders',
              margin: [0, 16, 0, 0]
            }
          ]
        : [])
    ]
  }
}
