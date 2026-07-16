// ───────────────────────────────────────────────
//  GET /api/transfers — historial de transferencias
// ───────────────────────────────────────────────
// Empleado: transferencias donde su tienda es origen o destino. Admin: todas.
import { and, desc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { products, stockMovements, stores, transferItems, transfers } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)
  const db = useDb()

  const filters = []
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(or(eq(transfers.fromStoreId, profile.storeId), eq(transfers.toStoreId, profile.storeId))!)
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(or(eq(transfers.fromStoreId, storeId), eq(transfers.toStoreId, storeId))!)
  }
  if (query.status) {
    filters.push(eq(transfers.status, String(query.status) as any))
  }

  // Rango de fechas sobre issuedAt (la fecha "de negocio" de la transferencia).
if (query.from) {
  const fromDate = new Date(String(query.from))
  if (!Number.isNaN(fromDate.getTime())) {
    filters.push(gte(transfers.issuedAt, fromDate))
  }
}
if (query.to) {
  const toDate = new Date(String(query.to))
  if (!Number.isNaN(toDate.getTime())) {
    filters.push(lt(transfers.issuedAt, toDate)) // exclusive, no lte
  }
}

  // Búsqueda: nota, código de sucursal (origen/destino), .
  const q = typeof query.q === 'string' ? query.q.trim() : ''
  if (q) {
    const like = `%${q}%`
    filters.push(
      or(
        ilike(transfers.note, like),
        sql`exists (select 1 from ${stores} s where s.id = ${transfers.fromStoreId} and (s.code ilike ${like} or s.name ilike ${like}))`,
        sql`exists (select 1 from ${stores} s where s.id = ${transfers.toStoreId} and (s.code ilike ${like} or s.name ilike ${like}))`,
        sql`exists (
          select 1 from ${transferItems} ti
          join ${products} p on p.id = ti.product_id
          where ti.transfer_id = ${transfers.id} and (p.name ilike ${like} or p.sku ilike ${like})
        )`
      )!
    )
  }

  const rows = await db.query.transfers.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [desc(transfers.createdAt)],
    limit: 200,
    with: {
      fromStore: { columns: { code: true, name: true } },
      toStore: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } },
      items: { columns: { id: true, quantity: true } }
    }
  })

  const transferIds = rows.map((r) => r.id)
  const valueMap = new Map<number, number>()
  if (transferIds.length) {
    const movs = await db.query.stockMovements.findMany({
      where: (m, { inArray, eq: eqOp }) => and(inArray(m.transferId, transferIds), eqOp(m.type, 'transferencia_salida')),
      columns: { transferId: true, totalValue: true }
    })
    for (const m of movs) {
      if (m.transferId == null) continue
      valueMap.set(m.transferId, (valueMap.get(m.transferId) ?? 0) + Math.abs(Number(m.totalValue)))
    }
  }

  return rows.map((t) => ({
    id: t.id,
    fromStoreId: t.fromStoreId,
    fromStoreCode: t.fromStore?.code ?? null,
    fromStoreName: t.fromStore?.name ?? null,
    toStoreId: t.toStoreId,
    toStoreCode: t.toStore?.code ?? null,
    toStoreName: t.toStore?.name ?? null,
    status: t.status,
    issuedAt: t.issuedAt,
    note: t.note,
    createdByName: t.createdBy?.fullName ?? null,
    itemCount: t.items.length,
    totalValue: Math.round((valueMap.get(t.id) ?? 0) * 100) / 100,
    createdAt: t.createdAt,
    receivedAt: t.receivedAt,
    canceledAt: t.canceledAt,
    cancelReason: t.cancelReason
  }))
})