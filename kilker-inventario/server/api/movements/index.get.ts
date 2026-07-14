// ───────────────────────────────────────────────
//  GET /api/movements — historial de entradas de stock
// ───────────────────────────────────────────────
// Empleado: su tienda. Admin: todas (filtro ?storeId).
// Filtros de fecha: ?from ?to (rango sobre created_at; from inclusivo, to exclusivo).
// Búsqueda ?q: producto (name/sku/barcode), nº factura proveedor, sucursal, empleado.
import { and, desc, eq, gte, ilike, inArray, lt, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { products, profiles, stockMovements, stores } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  // Solo entradas (los ajustes/anulaciones no se listan aquí).
  const filters = [eq(stockMovements.type, 'entrada')]

  // Filtro por tienda: forzado para empleado; opcional para admin.
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(eq(stockMovements.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(stockMovements.storeId, storeId))
  }

  // Rango de fechas (created_at): from inclusivo, to exclusivo.
    if (query.from) {
      const fromDate = new Date(String(query.from)).toISOString().slice(0, 10)
      filters.push(gte(stockMovements.supplierInvoiceDate, fromDate))
    }
    if (query.to) {
      const toDate = new Date(String(query.to)).toISOString().slice(0, 10)
      filters.push(lt(stockMovements.supplierInvoiceDate, toDate))
    }

  // Búsqueda de texto: pre-resolvemos ids que hacen match en tablas relacionadas
  // (producto/sucursal/empleado) y filtramos con inArray para no abandonar el
  // findMany relacional. La factura del proveedor se busca directo en la columna.
  const q = String(query.q ?? '').trim()
  if (q) {
    const like = `%${q}%`
    const [prodIds, storeIds, profIds] = await Promise.all([
      db
        .select({ id: products.id })
        .from(products)
        .where(
          or(
            ilike(products.name, like),
            ilike(products.sku, like),
            ilike(products.barcode, like)
          )
        ),
      db
        .select({ id: stores.id })
        .from(stores)
        .where(or(ilike(stores.name, like), ilike(stores.code, like))),
      db.select({ id: profiles.id }).from(profiles).where(ilike(profiles.fullName, like))
    ])

    const orParts = [ilike(stockMovements.supplierInvoiceNumber, like)]
    if (prodIds.length) {
      orParts.push(inArray(stockMovements.productId, prodIds.map((r) => r.id)))
    }
    if (storeIds.length) {
      orParts.push(inArray(stockMovements.storeId, storeIds.map((r) => r.id)))
    }
    if (profIds.length) {
      orParts.push(inArray(stockMovements.createdBy, profIds.map((r) => r.id)))
    }
    if (q) {
      orParts.push(ilike(stockMovements.inventoryEntryInvoiceNumber, like))
    }    
    filters.push(or(...orParts)!)
  }

  const rows = await db.query.stockMovements.findMany({
    where: and(...filters),
    orderBy: [desc(stockMovements.supplierInvoiceDate), desc(stockMovements.createdAt)],
    with: {
      product: { columns: { name: true, sku: true, unit: true } },
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } }
    }
  })

  return rows.map((m) => ({
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
    createdAt: m.createdAt
  }))
})
