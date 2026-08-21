// ───────────────────────────────────────────────
//  POST /api/sales — registrar una venta
// ───────────────────────────────────────────────
// En transacción: crea factura + líneas, movimientos de venta y baja inventario.
//
// KITS: un kit no tiene inventario propio. Al vender se EXPLOTA en líneas de
// producto normales (kardex y stock son siempre por producto), cada una marcada
//
// MUESTRAS: mismo principio. Una muestra tampoco tiene inventario propio: se
// RESUELVE a su producto base (1:1) antes de validar existencias, y a partir de
// ahí todo —kardex, saldo y `invoice_items.product_id`— habla del base. De la
// muestra solo queda el marcador en la línea y el precio, que siempre es 0.

import { and, eq, inArray, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import {
  customers,
  inventory,
  invoiceItems,
  invoices,
  products,
  salesKits,
  stockMovements,
  stores
} from '../../db/schema'
import { effectiveMovementDate } from '../../utils/movementDates'
import { isSampleProduct, stockProductId } from '../../utils/samples'

interface SaleItem {
  productId: number
  quantity: number
  unitPrice?: number
}
/** Un kit vendido: se explota en sus productos al registrar la venta. */
interface SaleKit {
  kitId: number
  quantity: number
}
interface SaleBody {
  storeId: number
  customerId?: number | null
  channel?: string
  note?: string
  paymentMethod?: string
  items: SaleItem[]
  kits?: SaleKit[]
  discount?: number
  issuedAt?: string
}

/** Línea ya resuelta (suelta o explotada de un kit), antes de fijar precio. */
interface PendingLine {
  /**
   * Producto que mueve inventario. Empieza siendo el pedido por el cliente y,
   * si resultó ser una muestra, se reemplaza por su producto base.
   */
  productId: number
  quantity: number
  /** Precio explícito; si es undefined se usa el de catálogo. */
  unitPrice?: number
  kitId: number | null
  kitSku: string | null
  kitName: string | null
  kitQuantity: number | null
  /** Muestra entregada en esta línea (null = venta normal). Snapshot. */
  sampleProductId: number | null
  sampleSku: string | null
  sampleName: string | null
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const body = await readBody<SaleBody>(event)

  const storeId = Number(body?.storeId)
  const items = Array.isArray(body?.items) ? body.items : []
  const kits = Array.isArray(body?.kits) ? body.kits : []
  // Una venta puede ser solo de productos sueltos, solo de kits, o mezcla.
  if (!storeId || (items.length === 0 && kits.length === 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'storeId y al menos un producto o kit son requeridos'
    })
  }
  for (const it of items) {
    if (!Number(it.productId) || !(Number(it.quantity) > 0)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cada item requiere productId y quantity (>0)'
      })
    }
  }
  for (const k of kits) {
    if (!Number(k.kitId) || !(Number(k.quantity) > 0)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Cada kit requiere kitId y quantity (>0)'
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

  if (isStoreScopedRole(profile.role) && profile.storeId !== storeId) {
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

    // ─── 1. Resolver las líneas pedidas: sueltas + explotadas de cada kit ───
    const pendingLines: PendingLine[] = items.map((it) => ({
      productId: Number(it.productId),
      quantity: Number(it.quantity),
      unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined,
      kitId: null,
      kitSku: null,
      kitName: null,
      kitQuantity: null,
      sampleProductId: null,
      sampleSku: null,
      sampleName: null
    }))

    for (const k of kits) {
      const kitId = Number(k.kitId)
      const kitQuantity = Number(k.quantity)

      const kit = await tx.query.salesKits.findFirst({
        where: eq(salesKits.id, kitId),
        with: { items: { with: { product: { columns: { price: true } } } } }
      })
      if (!kit) {
        throw createError({ statusCode: 404, statusMessage: `El kit ${kitId} no existe` })
      }
      if (!kit.isActive) {
        throw createError({ statusCode: 400, statusMessage: `El kit ${kit.sku} está inactivo` })
      }
      if (!kit.items.length) {
        throw createError({
          statusCode: 400,
          statusMessage: `El kit ${kit.sku} no tiene productos`
        })
      }

      for (const ki of kit.items) {
        // Precio del kit: el pactado en la línea del kit o, si es null, el de
        // catálogo del producto. El nombre y SKU se guardan como snapshot.
        const unitPrice =
          ki.unitPrice != null ? Number(ki.unitPrice) : Number(ki.product?.price ?? 0)
        pendingLines.push({
          productId: ki.productId,
          quantity: Number(ki.quantity) * kitQuantity,
          unitPrice,
          kitId: kit.id,
          kitSku: kit.sku,
          kitName: kit.name,
          kitQuantity,
          sampleProductId: null,
          sampleSku: null,
          sampleName: null
        })
      }
    }

    // ─── 1.b Resolver MUESTRAS a su producto base ───
    // Una muestra no tiene inventario propio: descuenta el del producto base
    // 1:1. Aquí —antes de validar existencias— se cambia el `productId` de la
    // línea por el del base y se guarda el marcador de qué muestra se entregó.
    // Hacerlo ANTES importa: es lo que permite que `requiredByProduct` sume en
    // el mismo cubo el producto vendido normal y el entregado como muestra en
    // la misma venta. Si se resolviera después, cada uno validaría contra el
    // saldo completo por separado y en conjunto podrían pasar de las
    // existencias reales.
    const requestedIds = [...new Set(pendingLines.map((l) => l.productId))]
    const requestedProducts = await tx.query.products.findMany({
      where: inArray(products.id, requestedIds)
    })
    const requestedById = new Map(requestedProducts.map((p) => [p.id, p]))

    for (const line of pendingLines) {
      const product = requestedById.get(line.productId)
      if (!product) {
        throw createError({
          statusCode: 404,
          statusMessage: `Producto ${line.productId} no existe`
        })
      }
      if (!isSampleProduct(product)) continue

      // Un kit se arma con productos, no con muestras (`POST /api/kits` ya lo
      // rechaza). Si alguno se colara, forzar su precio a 0 vaciaría el importe
      // del kit en silencio: mejor fallar.
      if (line.kitId != null) {
        throw createError({
          statusCode: 400,
          statusMessage: `El kit ${line.kitSku} contiene la muestra ${product.sku}: quita la muestra del kit y deja el producto base`
        })
      }
      if (!product.isActive) {
        throw createError({
          statusCode: 400,
          statusMessage: `La muestra ${product.sku} está inactiva`
        })
      }

      line.sampleProductId = product.id
      line.sampleSku = product.sku
      line.sampleName = product.name
      // El precio de una muestra es siempre 0; lo que mande el cliente se ignora.
      line.unitPrice = 0
      line.productId = stockProductId(product)
    }

    // Candado de fila ANTES de leer existencias. En READ COMMITTED, dos ventas
    // simultáneas del último artículo (o un doble clic) leen el mismo saldo,
    // las dos pasan la validación y el stock termina en negativo — que es
    // exactamente como nacen las "ventas sin respaldo" que descuadran el
    // inventario. La tienda ya se bloqueaba para el folio, así que las ventas
    // de una sucursal ya se serializaban: lo único que cambia es que ahora el
    // candado se toma ANTES de validar, no después.
    await tx.execute(sql`SELECT id FROM ${stores} WHERE id = ${storeId} FOR UPDATE`)

    // ─── 2. Validar existencia UNA sola vez por producto, con la cantidad
    //         TOTAL requerida. Un mismo producto puede venir suelto y además
    //         dentro de un kit en la misma venta: validar cada línea por
    //         separado dejaría pasar una venta que en conjunto no alcanza. ───
    const requiredByProduct = new Map<number, number>()
    for (const l of pendingLines) {
      requiredByProduct.set(l.productId, (requiredByProduct.get(l.productId) ?? 0) + l.quantity)
    }

    const productById = new Map<number, { sku: string; price: string }>()

    for (const [productId, quantity] of requiredByProduct) {
      const product = await tx.query.products.findFirst({ where: eq(products.id, productId) })
      if (!product) {
        throw createError({ statusCode: 404, statusMessage: `Producto ${productId} no existe` })
      }
      productById.set(productId, { sku: product.sku, price: product.price })

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
        // Trae TODOS los movimientos de este producto/tienda, sin filtrar por
        // created_at en SQL — el filtro real ocurre abajo usando la fecha
        // EFECTIVA (supplier_invoice_date para entradas cuando existe,
        // created_at en caso contrario). Filtrar por created_at aquí
        // excluiría entradas capturadas tarde en el sistema pero con
        // factura de fecha anterior a la venta.
        const priorMovements = await tx.query.stockMovements.findMany({
          where: and(
            eq(stockMovements.productId, productId),
            eq(stockMovements.storeId, storeId)
          ),
          columns: { quantity: true, type: true, supplierInvoiceDate: true, createdAt: true }
        })

        // Para entradas, si tienen supplier_invoice_date, esa es la fecha real
        // de referencia (puede diferir de created_at por captura retroactiva).
        // Se re-filtra usando esa fecha "efectiva" cuando exista.
        const netAtDate = priorMovements.reduce((sum, m) => {
          if (effectiveMovementDate(m) > effectiveDate) return sum
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
    }

    // ─── 3. Fijar precio definitivo de cada línea ───
    const lines = pendingLines.map((l) => {
      const unitPrice = l.unitPrice ?? Number(productById.get(l.productId)?.price ?? 0)
      return {
        productId: l.productId,
        quantity: l.quantity,
        unitPrice,
        lineTotal: l.quantity * unitPrice,
        kitId: l.kitId,
        kitSku: l.kitSku,
        kitName: l.kitName,
        kitQuantity: l.kitQuantity,
        sampleProductId: l.sampleProductId,
        sampleSku: l.sampleSku,
        sampleName: l.sampleName
      }
    })

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
        lineTotal: String(l.lineTotal),
        kitId: l.kitId,
        kitSku: l.kitSku,
        kitName: l.kitName,
        kitQuantity: l.kitQuantity == null ? null : String(l.kitQuantity),
        sampleProductId: l.sampleProductId,
        sampleSku: l.sampleSku,
        sampleName: l.sampleName
      })
      await tx.insert(stockMovements).values({
        // Siempre el producto base: una muestra no existe para el kardex.
        productId: l.productId,
        storeId,
        type: 'venta',
        quantity: String(-l.quantity),
        unitValue: String(l.unitPrice),
        totalValue: String(-l.lineTotal),
        invoiceId: invoice.id,
        // Única huella de la muestra en el kardex (el importe es 0 y sin esto
        // la salida parecería una venta regalada sin explicación).
        reason: l.sampleSku ? `Muestra ${l.sampleSku}` : null,
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