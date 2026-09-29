// utils/purchaseOrderPdf.ts — el pedido a proveedor como documento pdfmake
//
// Mismo estilo que utils/ticketPdf.ts (carta, logo, rejilla de datos, tabla con
// solo líneas horizontales). pdfmake se importa bajo demanda en la página.
import type { PdfContent, PdfDocDefinition } from 'pdfmake/build/pdfmake'
import type { ApiPurchaseOrderDetail } from '~/types/inventario'

const MUTED = '#6b7280'
const BORDER = '#e5e7eb'

const currencyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' })

const money = (n: number) => currencyFmt.format(n)
const fmtQty = (q: string) => (Number.isFinite(Number(q)) ? String(Number(q)) : '—')
function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : dateFmt.format(d)
}

function field(label: string, value: string): PdfContent {
  return {
    stack: [
      { text: label, fontSize: 8, color: MUTED },
      { text: value, fontSize: 10 }
    ],
    margin: [0, 0, 0, 8]
  }
}

function th(text: string, alignment: 'left' | 'right' = 'left'): PdfContent {
  return { text, alignment, fontSize: 8, color: MUTED, bold: true }
}

function separator(gapTop = 10, gapBottom = 10): PdfContent {
  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 0.5, lineColor: BORDER }],
    margin: [0, gapTop, 0, gapBottom]
  }
}

export function buildPurchaseOrderDoc(
  order: ApiPurchaseOrderDetail,
  logoDataUrl: string
): PdfDocDefinition {
  const body: PdfContent[][] = [
    [th('SKU'), th('Producto'), th('Cant.', 'right'), th('Precio', 'right'), th('Importe', 'right')]
  ]
  for (const it of order.items) {
    body.push([
      { text: it.sku, fontSize: 8, color: MUTED },
      { text: it.name, fontSize: 9 },
      { text: `${fmtQty(it.quantity)} ${it.unit}`, alignment: 'right', fontSize: 9 },
      { text: money(Number(it.unitPrice)), alignment: 'right', fontSize: 9 },
      { text: money(Number(it.lineTotal)), alignment: 'right', fontSize: 9 }
    ])
  }

  return {
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 10, color: '#111827' },
    info: { title: `Pedido · ${order.supplierName}`, subject: `Pedido a ${order.supplierName}` },
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: 'Precios sin IVA.', fontSize: 7, color: MUTED },
        { text: `${currentPage} / ${pageCount}`, fontSize: 7, color: MUTED, alignment: 'right' }
      ],
      margin: [40, 12, 40, 0]
    }),
    content: [
      // Sin folio ni estado: son control interno y este documento va al proveedor.
      {
        stack: [
          { image: logoDataUrl, width: 130, margin: [0, 0, 0, 6] },
          { text: 'Pedido a proveedor', fontSize: 9, color: MUTED }
        ]
      },

      separator(14, 12),

      {
        table: {
          widths: ['*', '*'],
          body: [
            [field('Proveedor', order.supplierName), field('Contacto', order.supplierContact ?? '—')],
            [
              field('Sucursal que pide', `${order.storeCode} · ${order.storeName}`),
              field('Fecha', fmtDate(order.createdAt))
            ],
            [field('Elaboró', order.createdByName ?? '—'), field('Productos', String(order.items.length))]
          ]
        },
        layout: 'noBorders'
      },

      ...(order.note ? [{ text: `"${order.note}"`, fontSize: 9, italics: true, color: MUTED }] : []),

      separator(6, 10),

      {
        table: { headerRows: 1, widths: [70, '*', 60, 70, 75], body },
        layout: {
          hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => BORDER,
          paddingLeft: (i: number) => (i === 0 ? 0 : 6),
          paddingRight: (i: number) => (i === 4 ? 0 : 6),
          paddingTop: () => 5,
          paddingBottom: () => 5
        }
      },

      separator(12, 8),

      {
        columns: [
          { text: 'Total del pedido', width: '*', bold: true, fontSize: 12 },
          { text: money(Number(order.total)), width: 'auto', bold: true, fontSize: 12, alignment: 'right' }
        ]
      }
    ]
  }
}