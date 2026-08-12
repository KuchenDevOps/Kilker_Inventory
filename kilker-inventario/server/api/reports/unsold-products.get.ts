// ───────────────────────────────────────────────
//  GET /api/reports/unsold-products — productos activos sin ventas en el periodo
// ───────────────────────────────────────────────

import { and, eq, gte, isNull, lt } from 'drizzle-orm'
import { useDb } from '../../db'
import { invoiceItems, invoices, products } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)
  const db = useDb()

  let storeId: number | undefined
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    storeId = profile.storeId
  } else if (query.storeId) {
    const id = Number(query.storeId)
    if (id) storeId = id
  }

  const fromDate = query.from ? new Date(String(query.from)) : null
  const toDate = query.to ? new Date(String(query.to)) : null

  const salesFilters = [eq(invoices.status, 'emitida')]
  if (storeId) salesFilters.push(eq(invoices.storeId, storeId))
  if (fromDate) salesFilters.push(gte(invoices.issuedAt, fromDate))
  if (toDate) salesFilters.push(lt(invoices.issuedAt, toDate))

  const salesSubquery = db
    .select({ productId: invoiceItems.productId })
    .from(invoiceItems)
    .innerJoin(invoices, eq(invoiceItems.invoiceId, invoices.id))
    .where(and(...salesFilters))
    .groupBy(invoiceItems.productId)
    .as('sales_agg')

  const rows = await db
    .select({
      productId: products.id,
      productName: products.name,
      productSku: products.sku,
      unit: products.unit,
      category: products.categoryId
    })
    .from(products)
    .leftJoin(salesSubquery, eq(salesSubquery.productId, products.id))
    .where(and(eq(products.isActive, true), isNull(salesSubquery.productId)))
    .orderBy(products.name)

  return rows
})