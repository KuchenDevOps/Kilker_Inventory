// ───────────────────────────────────────────────
//  POST /api/sales — registrar una venta
// ───────────────────────────────────────────────
// En transacción: crea factura + líneas, movimientos de venta y baja inventario.
import { and, eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { inventory, invoiceItems, invoices, products, stockMovements, stores } from '../../db/schema'

interface SaleItem {
  productId: number
  quantity: number
  unitPrice?: number
}
interface SaleBody {
  storeId: number
  note?: string
  paymentMethod?: string
  items: SaleItem[]
  discount?: number 
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

  // Método de pago (corte de caja). Default efectivo.
  const allowed = ['efectivo', 'tarjeta', 'transferencia'] as const
  const paymentMethod = allowed.includes(body?.paymentMethod as never)
    ? (body?.paymentMethod as (typeof allowed)[number])
    : 'efectivo'

  // El empleado solo vende en su tienda.
  if (profile.role === 'empleado' && profile.storeId !== storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'El empleado solo puede vender en su tienda'
    })
  }

  const db = useDb()

  return await db.transaction(async (tx) => {
    const store = await tx.query.stores.findFirst({ where: eq(stores.id, storeId) })
    if (!store) throw createError({ statusCode: 404, statusMessage: 'Tienda no existe' })

    // Resolver precios (snapshot) y validar existencias antes de escribir.
    const lines: { productId: number; quantity: number; unitPrice: number; lineTotal: number }[] = []
    for (const it of items) {
      const productId = Number(it.productId)
      const quantity = Number(it.quantity)
      const product = await tx.query.products.findFirst({ where: eq(products.id, productId) })
      if (!product) {
        throw createError({ statusCode: 404, statusMessage: `Producto ${productId} no existe` })
      }
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
      const unitPrice = it.unitPrice != null ? Number(it.unitPrice) : Number(product.price)
      lines.push({ productId, quantity, unitPrice, lineTotal: quantity * unitPrice })
    }

    const subTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0)

    const discountPct = Math.min(Math.max(Number(body?.discount ?? 0), 0), 100)

    const discountAmount = subTotal * (discountPct / 100)

    const totalAmount = subTotal - discountAmount

    // Folio provisional por tienda (secuencia formal pendiente).
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
        createdBy: profile.id,
        status: 'emitida',
        paymentMethod,
        note: body.note ?? null,
        totalAmount: String(totalAmount)
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
