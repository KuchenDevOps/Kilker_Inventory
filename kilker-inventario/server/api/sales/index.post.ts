// ───────────────────────────────────────────────
//  POST /api/sales — registrar una venta
// ───────────────────────────────────────────────
// En transacción: crea factura + líneas, movimientos de venta y baja inventario.
import { and, eq, lte, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import {
  customers,
  inventory,
  invoiceItems,
  invoices,
  products,
  stockMovements,
  stores
} from '../../db/schema'

interface SaleItem {
  productId: number
  quantity: number
  unitPrice?: number
}
interface SaleBody {
  storeId: number
  customerId?: number | null
  channel?: string
  note?: string
  paymentMethod?: string
  items: SaleItem[]
  discount?: number
  issuedAt?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const body = await readBody<SaleBody>(event)

  const storeId = Number(body?.storeId)
  const items = Array.isArray(body?.items) ? body.items : []
  if (!storeId || items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'storeId e items son requeridos' })
  }
  for (const it of items) {
    if (!Number(it.productId) || !(Number(it.quantity) > 0)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cada item requiere productId y quantity (>0)'
      })
    }
  }

  const allowedPayments = ['efectivo', 'tarjeta', 'transferencia'] as const
  const paymentMethod = allowedPayments.includes(body?.paymentMethod as never)
    ? (body?.paymentMethod as (typeof allowedPayments)[number])
    : 'efectivo'

  const allowedChannels = ['mostrador', 'en_linea'] as const
  const channel = allowedChannels.includes(body?.channel as never)
    ? (body?.channel as (typeof allowedChannels)[number])
    : 'mostrador'

  let customerId: number | null = null
  if (body?.customerId != null) {
    customerId = Number(body.customerId)
    if (!customerId) {
      throw createError({ statusCode: 400, statusMessage: 'customerId inválido' })
    }
  }

  if (profile.role === 'empleado' && profile.storeId !== storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'El empleado solo puede vender en su tienda'
    })
  }

  // Fecha de la venta: si no se especifica, usa el momento actual.
  let issuedAt: Date | undefined
  if (body?.issuedAt) {
    const parsed = new Date(body.issuedAt)
    if (Number.isNaN(parsed.getTime())) {
      throw createError({ statusCode: 400, statusMessage: 'Fecha de venta inválida' })
    }
    issuedAt = parsed
  }
  const effectiveDate = issuedAt ?? new Date()
  // Solo se valida "stock a la fecha" para ventas retroactivas (fecha pasada
  // explícita). Para ventas en tiempo real, el chequeo normal contra el
  // inventario actual ya es suficiente y más rápido.
  const isBackdated = issuedAt != null && issuedAt.getTime() < Date.now() - 60 * 1000

  const db = useDb()

  return await db.transaction(async (tx) => {
    const store = await tx.query.stores.findFirst({ where: eq(stores.id, storeId) })
    if (!store) throw createError({ statusCode: 404, statusMessage: 'Tienda no existe' })
    if (!store.isActive) {
      throw createError({ statusCode: 400, statusMessage: 'La sucursal está inactiva' })
    }

    if (customerId != null) {
      const customer = await tx.query.customers.findFirst({
        where: eq(customers.id, customerId)
      })
      if (!customer) {
        throw createError({ statusCode: 400, statusMessage: 'El cliente no existe' })
      }
    }

    const lines: { productId: number; quantity: number; unitPrice: number; lineTotal: number }[] = []
    for (const it of items) {
      const productId = Number(it.productId)
      const quantity = Number(it.quantity)
      const product = await tx.query.products.findFirst({ where: eq(products.id, productId) })
      if (!product) {
        throw createError({ statusCode: 404, statusMessage: `Producto ${productId} no existe` })
      }

      // Validación estándar: contra el inventario actual (siempre se hace).
      const inv = await tx.query.inventory.findFirst({
        where: and(eq(inventory.productId, productId), eq(inventory.storeId, storeId))
      })
      const available = inv ? Number(inv.quantity) : 0
      if (available < quantity) {
        throw createError({
          statusCode: 400,
          statusMessage: `Stock insuficiente de ${product.sku} en ${store.code}: hay ${available}, se piden ${quantity}`
        })
      }

      // Validación adicional para ventas con fecha retroactiva: verifica que,
      // A LA FECHA declarada de la venta, ya hubiera suficiente stock (evita
      // registrar una venta "en el pasado" antes de que la mercancía hubiera
      // entrado según el kardex — el mismo desfase que causó los shortfalls
      // detectados en el reporte mensual).
      if (isBackdated) {
        const priorMovements = await tx.query.stockMovements.findMany({
          where: and(
            eq(stockMovements.productId, productId),
            eq(stockMovements.storeId, storeId),
            lte(stockMovements.createdAt, effectiveDate)
          ),
          columns: { quantity: true, type: true, supplierInvoiceDate: true, createdAt: true }
        })

        // Para entradas, si tienen supplier_invoice_date, esa es la fecha real
        // de referencia (puede diferir de created_at por captura retroactiva).
        // Se re-filtra usando esa fecha "efectiva" cuando exista.
        const netAtDate = priorMovements.reduce((sum, m) => {
          const effective =
            m.type === 'entrada' && m.supplierInvoiceDate
              ? new Date(m.supplierInvoiceDate)
              : m.createdAt
          if (effective > effectiveDate) return sum
          return sum + Number(m.quantity)
        }, 0)

        if (netAtDate < quantity) {
          throw createError({
            statusCode: 400,
            statusMessage:
              `No se puede registrar esta venta con fecha ${effectiveDate.toISOString().slice(0, 10)}: ` +
              `según el kardex, a esa fecha solo había ${netAtDate} unidad(es) de ${product.sku} disponibles ` +
              `en ${store.code} (se piden ${quantity}). Revisa si falta registrar una entrada anterior a esta fecha.`
          })
        }
      }

      const unitPrice = it.unitPrice != null ? Number(it.unitPrice) : Number(product.price)
      lines.push({ productId, quantity, unitPrice, lineTotal: quantity * unitPrice })
    }

    const subTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0)
    const discountPct = Math.min(Math.max(Number(body?.discount ?? 0), 0), 100)
    const discountAmount = subTotal * (discountPct / 100)
    const totalAmount = subTotal - discountAmount

    const [folioRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(eq(invoices.storeId, storeId))
    const folio = `${store.code}-${String(Number(folioRow?.count ?? 0) + 1).padStart(4, '0')}`

    const [invoice] = await tx
      .insert(invoices)
      .values({
        folio,
        storeId,
        customerId,
        channel,
        createdBy: profile.id,
        status: 'emitida',
        paymentMethod,
        note: body.note ?? null,
        discountPct: String(discountPct),
        discountAmount: String(discountAmount),
        totalAmount: String(totalAmount),
        ...(issuedAt ? { issuedAt } : {})
      })
      .returning()
    if (!invoice) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo crear la factura' })
    }

    for (const l of lines) {
      await tx.insert(invoiceItems).values({
        invoiceId: invoice.id,
        productId: l.productId,
        quantity: String(l.quantity),
        unitPrice: String(l.unitPrice),
        lineTotal: String(l.lineTotal)
      })
      await tx.insert(stockMovements).values({
        productId: l.productId,
        storeId,
        type: 'venta',
        quantity: String(-l.quantity),
        unitValue: String(l.unitPrice),
        totalValue: String(-l.lineTotal),
        invoiceId: invoice.id,
        createdBy: profile.id
      })
      await tx
        .update(inventory)
        .set({ quantity: sql`${inventory.quantity} - ${l.quantity}`, updatedAt: new Date() })
        .where(and(eq(inventory.productId, l.productId), eq(inventory.storeId, storeId)))
    }

    return { invoice, items: lines }
  })
})