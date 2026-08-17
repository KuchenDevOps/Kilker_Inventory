// TEMPORAL — renderiza el ticket con datos de ejemplo para revisar el diseño.
// Usa el pdfmake de Node (mismo docDefinition que el navegador).
// Ejecutar: npx tsx scripts/_preview-ticket.ts
import pdfmake from 'pdfmake'
import { buildSaleTicketDoc } from '../app/utils/ticketPdf'
import type { ApiSaleDetail } from '../app/types/inventario'

const sale = {
  id: 1,
  folio: 'CEN-0042',
  storeId: 1,
  storeCode: 'CEN',
  storeName: 'Sucursal Centro',
  customerId: 3,
  customerName: 'Constructora del Bajío S.A. de C.V.',
  channel: 'mostrador',
  status: 'emitida',
  paymentMethod: 'efectivo',
  subtotalAmount: '3480.00',
  discountPct: '10',
  discountAmount: '348.00',
  totalAmount: '3132.00',
  note: 'Entregar en obra el viernes.',
  itemCount: 4,
  createdByName: 'Fernando Ruiz',
  issuedAt: '2026-08-14T16:32:00.000Z',
  voidedAt: null,
  voidReason: null,
  items: [
    {
      id: 1, productId: 10, productName: 'Esmalte sintético blanco brillante 1 L',
      productSku: 'ESM-BLA-1L', unit: 'pieza', quantity: '4.000', unitPrice: '285.00',
      lineTotal: '1140.00', kitId: null, kitSku: null, kitName: null, kitQuantity: null
    },
    {
      id: 2, productId: 22, productName: 'Thinner estándar 5 L',
      productSku: 'THI-EST-5L', unit: 'pieza', quantity: '2.000', unitPrice: '420.00',
      lineTotal: '840.00', kitId: null, kitSku: null, kitName: null, kitQuantity: null
    },
    {
      id: 3, productId: 31, productName: 'Rodillo felpa 9"',
      productSku: 'ROD-FEL-9', unit: 'pieza', quantity: '3.000', unitPrice: '120.00',
      lineTotal: '360.00', kitId: 7, kitSku: 'KIT-PINT-BAS', kitName: 'Kit pintor básico',
      kitQuantity: '3'
    },
    {
      id: 4, productId: 32, productName: 'Charola metálica para rodillo',
      productSku: 'CHA-MET', unit: 'pieza', quantity: '3.000', unitPrice: '380.00',
      lineTotal: '1140.00', kitId: 7, kitSku: 'KIT-PINT-BAS', kitName: 'Kit pintor básico',
      kitQuantity: '3'
    }
  ]
} as unknown as ApiSaleDetail

pdfmake.addFonts({
  Roboto: {
    normal: 'node_modules/pdfmake/fonts/Roboto/Roboto-Regular.ttf',
    bold: 'node_modules/pdfmake/fonts/Roboto/Roboto-Medium.ttf',
    italics: 'node_modules/pdfmake/fonts/Roboto/Roboto-Italic.ttf',
    bolditalics: 'node_modules/pdfmake/fonts/Roboto/Roboto-MediumItalic.ttf'
  }
})

const out = process.argv[2] ?? 'ticket-preview.pdf'
await pdfmake.createPdf(buildSaleTicketDoc(sale)).write(out)
console.log('escrito:', out)

// Segunda pasada con la venta anulada: es la única rama del documento que la
// venta de ejemplo no ejercita.
const voided = {
  ...sale,
  folio: 'CEN-0043',
  status: 'anulada',
  voidedAt: '2026-08-14T18:00:00.000Z',
  voidReason: 'Cliente canceló el pedido antes de la entrega.'
} as unknown as ApiSaleDetail

const voidedOut = out.replace(/\.pdf$/, '-anulada.pdf')
await pdfmake.createPdf(buildSaleTicketDoc(voided)).write(voidedOut)
console.log('escrito:', voidedOut)
