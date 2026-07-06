// ───────────────────────────────────────────────
//  GET /api/reports/top-products — productos más vendidos
// ───────────────────────────────────────────────
// Suma quantity/line_total de invoice_items, solo facturas emitidas.
// Empleado: su tienda. Admin: todas (filtro ?storeId).
// Filtros de fecha: ?from ?to (rango sobre issued_at). ?limit: top N (default 5, 0 = todos).
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoiceItems, invoices, products } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  const filters = [eq(invoices.status, 'emitida')]

  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(eq(invoices.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(invoices.storeId, storeId))
  }

  if (query.from) filters.push(gte(invoices.issuedAt, new Date(String(query.from))))
  if (query.to) filters.push(lt(invoices.issuedAt, new Date(String(query.to))))

  const limit = query.limit != null ? Number(query.limit) : 5

  const rows = await db
    .select({
      productId: products.id,
      productName: products.name,
      productSku: products.sku,
      unit: products.unit,
      totalQuantity: sql<string>`sum(${invoiceItems.quantity})`,
      totalRevenue: sql<string>`sum(${invoiceItems.lineTotal})`
    })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .innerJoin(products, eq(invoiceItems.productId, products.id))
    .where(and(...filters))
    .groupBy(products.id, products.name, products.sku, products.unit)
    .orderBy(desc(sql`sum(${invoiceItems.quantity})`))
    .limit(limit > 0 ? limit : 1000) // 0 = "todos": límite alto de seguridad

  return rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    productSku: r.productSku,
    unit: r.unit,
    totalQuantity: Number(r.totalQuantity),
    totalRevenue: Number(r.totalRevenue)
  }))
})