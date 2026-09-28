// ───────────────────────────────────────────────
//  GET /api/purchase-orders — pedidos a proveedores
//  ?page&pageSize · ?status · ?storeId (solo roles globales) · ?q · ?from/?to
// ───────────────────────────────────────────────
import { and, count, desc, eq, gte, ilike, lt, or, type SQL } from 'drizzle-orm'
import { useDb } from '../../db'
import { purchaseOrders } from '../../db/schema'
import {
  isPurchaseOrderStatus,
  purchaseOrderFolioSql,
  purchaseOrdersBaseQuery
} from '../../utils/purchaseOrders'

function toDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const conds: SQL[] = []

  // Rol acotado: solo su sucursal, diga lo que diga la query.
  if (isStoreScopedRole(profile.role)) {
    if (profile.storeId == null) {
      throw createError({ statusCode: 403, statusMessage: 'Tu usuario no tiene sucursal asignada' })
    }
    conds.push(eq(purchaseOrders.storeId, profile.storeId))
  } else if (query.storeId) {
    conds.push(eq(purchaseOrders.storeId, Number(query.storeId)))
  }

  if (isPurchaseOrderStatus(query.status)) {
    conds.push(eq(purchaseOrders.status, query.status))
  }

  const q = typeof query.q === 'string' ? query.q.trim() : ''
  if (q) {
    const like = `%${q}%`
    conds.push(or(ilike(purchaseOrders.supplierName, like), ilike(purchaseOrderFolioSql(), like))!)
  }

  // `to` exclusivo, igual que FiltroPeriodo.
  const from = toDate(query.from)
  const to = toDate(query.to)
  if (from) conds.push(gte(purchaseOrders.createdAt, from))
  if (to) conds.push(lt(purchaseOrders.createdAt, to))

  const where = conds.length ? and(...conds) : undefined
  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  let rows = purchaseOrdersBaseQuery()
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
  if (paginate) rows = rows.limit(pageSize).offset((page - 1) * pageSize)
  const data = await rows

  if (!paginate) return data

  const total =
    (await useDb().select({ value: count() }).from(purchaseOrders).where(where))[0]?.value ?? 0

  return { data, total, page, pageSize }
})