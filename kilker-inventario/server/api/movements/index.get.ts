import { and, count, desc, eq, gte, ilike, inArray, lt, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { products, profiles, stockMovements, stores } from '../../db/schema'


export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)
  const db = useDb()

  const filters = [eq(stockMovements.type, 'entrada')]

  if (profile.role === 'empleado') {
    if (profile.storeId == null) {
      return query.page ? { data: [], total: 0, page: 1, pageSize: 100 } : []
    }
    filters.push(eq(stockMovements.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(stockMovements.storeId, storeId))
  }

  if (query.from) {
    const fromDate = new Date(String(query.from)).toISOString().slice(0, 10)
    filters.push(gte(stockMovements.supplierInvoiceDate, fromDate))
  }
  if (query.to) {
    const toDate = new Date(String(query.to)).toISOString().slice(0, 10)
    filters.push(lt(stockMovements.supplierInvoiceDate, toDate))
  }

  const q = String(query.q ?? '').trim()
  if (q) {
    const like = `%${q}%`
    const [prodIds, storeIds, profIds] = await Promise.all([
      db.select({ id: products.id }).from(products).where(
        or(ilike(products.name, like), ilike(products.sku, like), ilike(products.barcode, like))
      ),
      db.select({ id: stores.id }).from(stores).where(
        or(ilike(stores.name, like), ilike(stores.code, like))
      ),
      db.select({ id: profiles.id }).from(profiles).where(ilike(profiles.fullName, like))
    ])

    const orParts = [
      ilike(stockMovements.supplierInvoiceNumber, like),
      ilike(stockMovements.inventoryEntryInvoiceNumber, like)
    ]
    if (prodIds.length) orParts.push(inArray(stockMovements.productId, prodIds.map((r) => r.id)))
    if (storeIds.length) orParts.push(inArray(stockMovements.storeId, storeIds.map((r) => r.id)))
    if (profIds.length) orParts.push(inArray(stockMovements.createdBy, profIds.map((r) => r.id)))

    filters.push(or(...orParts)!)
  }

  const whereClause = and(...filters)

  // ── Paginación: SOLO se activa si viene ?page en la query ──
  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.stockMovements.findMany({
    where: whereClause,
    orderBy: [desc(stockMovements.supplierInvoiceDate), desc(stockMovements.createdAt)],
    ...(paginate ? { limit: pageSize, offset: (page - 1) * pageSize } : {}),
    with: {
      product: { columns: { name: true, sku: true, unit: true } },
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } }
    }
  })
    const movementIds = rows.map((m) => m.id)
  const voided = new Set<number>()
  if (movementIds.length) {
    const reversals = await db
      .select({ reversesMovementId: stockMovements.reversesMovementId })
      .from(stockMovements)
      .where(and(eq(stockMovements.type, 'anulacion'), inArray(stockMovements.reversesMovementId, movementIds)))
    for (const r of reversals) if (r.reversesMovementId != null) voided.add(r.reversesMovementId)
  }

  const mapped = rows.map((m) => ({
    id: m.id,
    productId: m.productId,
    productName: m.product?.name ?? null,
    productSku: m.product?.sku ?? null,
    unit: m.product?.unit ?? null,
    storeId: m.storeId,
    storeCode: m.store?.code ?? null,
    storeName: m.store?.name ?? null,
    quantity: m.quantity,
    unitValue: m.unitValue,
    totalValue: m.totalValue,
    supplierInvoiceNumber: m.supplierInvoiceNumber,
    supplierInvoiceDate: m.supplierInvoiceDate,
    folio: m.inventoryEntryInvoiceNumber,
    createdByName: m.createdBy?.fullName ?? null,
    createdAt: m.createdAt,
    voided: voided.has(m.id),
  }))

  if (!paginate) return mapped // ← comportamiento original, usa el dashboard

    // Después de traer `rows`, antes del return:


  const [{ value: total }] = await db.select({ value: count() }).from(stockMovements).where(whereClause)
  return { data: mapped, total, page, pageSize }
})