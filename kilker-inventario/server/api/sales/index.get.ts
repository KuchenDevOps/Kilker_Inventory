// ───────────────────────────────────────────────
//  GET /api/sales — historial de ventas
// ───────────────────────────────────────────────
// Empleado: su tienda. Admin: todas (filtros ?storeId/?status/?productId).
import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import {
  customers,
  invoices,
  paymentMethod as paymentMethodEnum,
  profiles,
  stores,
  tickets
} from '../../db/schema'

/**
 * Texto contra el que se busca cada método de pago en `?q`. Sin acentos, para
 * que "débito" y "debito" den lo mismo. Va aquí y no en `PAYMENT_LABELS` porque
 * ese archivo es del cliente (`app/types`) y esto solo lo usa la búsqueda.
 */
const PAYMENT_SEARCH_LABELS: Record<(typeof paymentMethodEnum.enumValues)[number], string> = {
  efectivo: 'efectivo',
  debito: 'tarjeta de debito',
  credito: 'tarjeta de credito',
  transferencia: 'transferencia'
}

/** Minúsculas y sin diacríticos, para comparar la búsqueda con las etiquetas. */
const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  const filters = []
  if (isStoreScopedRole(profile.role)) {
    if (profile.storeId == null) return []
    filters.push(eq(invoices.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(invoices.storeId, storeId))
  }
  if (query.status === 'emitida' || query.status === 'anulada') {
    filters.push(eq(invoices.status, query.status))
  }

  // Filtro por producto: ventas que contienen ese productId en alguna línea.
 if (query.productId) {
  const productId = Number(query.productId)
  if (productId) {
    filters.push(sql`exists (
      select 1 from invoice_items ii
      where ii.invoice_id = invoices.id
        and ii.product_id = ${productId}
    )`)
  }
}

  if (query.from) filters.push(gte(invoices.issuedAt, new Date(String(query.from))))
  if (query.to) filters.push(lt(invoices.issuedAt, new Date(String(query.to))))

  const q = String(query.q ?? '').trim()
  if (q) {
    const like = `%${q}%`
    const [storeIds, profIds, customerIds] = await Promise.all([
      db.select({ id: stores.id }).from(stores).where(or(ilike(stores.name, like), ilike(stores.code, like))),
      db.select({ id: profiles.id }).from(profiles).where(ilike(profiles.fullName, like)),
      db.select({ id: customers.id }).from(customers).where(ilike(customers.name, like))
    ])

    const orParts = [ilike(invoices.folio, like)]
    const pm = normalize(q)
    // Buscar "tarjeta" ya no matchea ningún valor del enum ('debito'/'credito'),
    // así que se busca también contra la etiqueta visible de cada método.
    for (const m of paymentMethodEnum.enumValues) {
      if (m.includes(pm) || PAYMENT_SEARCH_LABELS[m].includes(pm)) {
        orParts.push(eq(invoices.paymentMethod, m))
      }
    }
    if (storeIds.length) orParts.push(inArray(invoices.storeId, storeIds.map((r) => r.id)))
    if (profIds.length) orParts.push(inArray(invoices.createdBy, profIds.map((r) => r.id)))
    if (customerIds.length) orParts.push(inArray(invoices.customerId, customerIds.map((r) => r.id)))
    filters.push(or(...orParts)!)
  }

  const whereClause = filters.length ? and(...filters) : undefined

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  // ─── FIX: modo exportación explícito, sin tope de 200 ───
  // Antes: `const limit = paginate ? pageSize : 200` truncaba silenciosamente
  // cualquier export sin ?page a un máximo de 200 filas.
  const exportAllFlag = query.all === 'true'

  const limit = paginate ? pageSize : (exportAllFlag ? undefined : 200)
  const offset = paginate ? (page - 1) * pageSize : 0

  const rows = await db.query.invoices.findMany({
    where: whereClause,
    orderBy: [desc(invoices.issuedAt)],
    ...(limit != null ? { limit } : {}),   // ← si limit es undefined, no se pasa (Drizzle trae todo)
    offset,
    with: {
      store: { columns: { code: true, name: true } },
      customer: { columns: { name: true } },
      createdBy: { columns: { fullName: true } },
      payments: { columns: { amount: true } },
      items: {
        columns: {
          id: true,
          productId: true,
          quantity: true,
          unitPrice: true,
          lineTotal: true,
          kitId: true,
          kitSku: true,
          kitName: true,
          kitQuantity: true,
          sampleProductId: true,
          sampleSku: true,
          sampleName: true
        },
        with: { product: { columns: { name: true, sku: true, unit: true } } }
      }
    }
  })
  // ─── fin del fix en la query ───

  const invoiceIds = rows.map((r) => r.id)
  const pending = new Set<number>()
  if (invoiceIds.length) {
    const open = await db
      .select({ invoiceId: tickets.invoiceId })
      .from(tickets)
      .where(and(eq(tickets.status, 'abierto'), inArray(tickets.invoiceId, invoiceIds)))
    for (const t of open) if (t.invoiceId != null) pending.add(t.invoiceId)
  }

  const mapped = rows.map((inv) => {
    // ─── Estado de cobro (derivado, no vive en la BD) ───
    // ⚠️ El cobrable es la columna GENERADA `total_to_pay` = subtotal (ya con
    // descuento) + IVA. No se recalcula aquí: el 16% de las ventas dejó de ser
    // informativo y su única definición es la del DDL.
    const totalToPay = Math.round(Number(inv.totalToPay) * 100) / 100
    const totalPaid =
      Math.round(inv.payments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100
    const balance = Math.max(0, Math.round((totalToPay - totalPaid) * 100) / 100)

    let paymentStatus: 'pendiente' | 'parcial' | 'pagado' | 'anulada' = 'pendiente'
    if (inv.status === 'anulada') paymentStatus = 'anulada'
    // Una venta de $0 nace pagada: no hay nada que cobrar. Es el caso de las
    // entregas de muestras (su precio es 0 por constraint) y el de un 100% de
    // descuento. Sin esta rama se quedarían "pendientes" para siempre.
    else if (totalToPay <= 0) paymentStatus = 'pagado'
    else if (totalPaid >= totalToPay) paymentStatus = 'pagado'
    else if (totalPaid > 0) paymentStatus = 'parcial'

    return {
      id: inv.id,
      folio: inv.folio,
      storeId: inv.storeId,
      storeCode: inv.store?.code ?? null,
      storeName: inv.store?.name ?? null,
      customerId: inv.customerId,
      customerName: inv.customer?.name ?? null,
      channel: inv.channel,
      status: inv.status,
      paymentMethod: inv.paymentMethod,
      discountPct: inv.discountPct,
      discountAmount: inv.discountAmount,
      // Subtotal ANTES del descuento: se deriva (el descuento es un % de él).
      subtotalAmount: String(Number(inv.totalAmount) + Number(inv.discountAmount)),
      totalAmount: inv.totalAmount,
      /** IVA cobrado (columna generada). Ya NO es informativo. */
      iva: inv.iva,
      note: inv.note,
      itemCount: inv.items.length,
      createdByName: inv.createdBy?.fullName ?? null,
      issuedAt: inv.issuedAt,
      voidedAt: inv.voidedAt,
      voidReason: inv.voidReason,
      pendingCorrection: pending.has(inv.id),
      totalToPay,
      totalPaid,
      balance,
      paymentStatus,
      items: inv.items.map((it) => ({
        id: it.id,
        productId: it.productId,
        productName: it.product?.name ?? null,
        productSku: it.product?.sku ?? null,
        unit: it.product?.unit ?? null,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
        kitId: it.kitId,
        kitSku: it.kitSku,
        kitName: it.kitName,
        kitQuantity: it.kitQuantity,
        // Muestra entregada en la línea (null = venta normal). `productId` y
        // `productSku` de arriba son SIEMPRE el producto base, que es el que
        // movió inventario; esto solo dice que salió como muestra.
        sampleProductId: it.sampleProductId,
        sampleSku: it.sampleSku,
        sampleName: it.sampleName
      }))
    }
  })
  if (!paginate) return mapped

  // ─── Agregados del filtro COMPLETO, no de la página ───
  // La tarjeta de totales de /ventas tiene que sumar todo lo que cumple el
  // filtro; sumar `mapped` daría el total de las 100 filas visibles y cambiaría
  // al pasar de página. Va en la misma pasada que el `count()` de paginación.
  //
  // ⚠️ El agregado que cuenta como venta es SOLO el de las emitidas: una
  // factura anulada devolvió la mercancía al inventario y perdió sus abonos, no
  // es ingreso. Las anuladas se devuelven aparte para que la pantalla pueda
  // decir cuánto quedó fuera en vez de esconderlo.
  const agg = (
    await db
      .select({
        total: count(),
        issuedCount: sql<number>`count(*) filter (where ${invoices.status} = 'emitida')::int`,
        issuedAmount: sql<string>`coalesce(sum(${invoices.totalAmount}) filter (where ${invoices.status} = 'emitida'), 0)`,
        // ⚠️ El IVA del agregado sale de la SUMA de las columnas generadas, no
        // del 16% del total sumado: redondear cada factura y luego sumar no da
        // lo mismo que sumar y luego redondear, y la tarjeta tiene que cuadrar
        // contra los renglones del listado, que llevan el IVA de cada una.
        issuedIva: sql<string>`coalesce(sum(${invoices.iva}) filter (where ${invoices.status} = 'emitida'), 0)`,
        issuedTotalToPay: sql<string>`coalesce(sum(${invoices.totalToPay}) filter (where ${invoices.status} = 'emitida'), 0)`,
        voidedCount: sql<number>`count(*) filter (where ${invoices.status} = 'anulada')::int`,
        voidedAmount: sql<string>`coalesce(sum(${invoices.totalAmount}) filter (where ${invoices.status} = 'anulada'), 0)`,
        voidedTotalToPay: sql<string>`coalesce(sum(${invoices.totalToPay}) filter (where ${invoices.status} = 'anulada'), 0)`
      })
      .from(invoices)
      .where(whereClause)
  )[0]

  return {
    data: mapped,
    total: agg?.total ?? 0,
    page,
    pageSize,
    totals: {
      issuedCount: Number(agg?.issuedCount ?? 0),
      /** Subtotal: con el descuento aplicado y SIN IVA. Es el ingreso del negocio. */
      issuedAmount: Math.round(Number(agg?.issuedAmount ?? 0) * 100) / 100,
      issuedIva: Math.round(Number(agg?.issuedIva ?? 0) * 100) / 100,
      /** Lo que se le cobra al cliente: subtotal + IVA. */
      issuedTotalToPay: Math.round(Number(agg?.issuedTotalToPay ?? 0) * 100) / 100,
      voidedCount: Number(agg?.voidedCount ?? 0),
      voidedAmount: Math.round(Number(agg?.voidedAmount ?? 0) * 100) / 100,
      voidedTotalToPay: Math.round(Number(agg?.voidedTotalToPay ?? 0) * 100) / 100
    }
  }
})