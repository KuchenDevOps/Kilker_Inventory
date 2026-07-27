import { and, count, desc, eq, gte, ilike, lt } from 'drizzle-orm'
import { useDb } from '../../db'
import { cashCloseouts } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  const filters = []
  if (profile.role === 'empleado') {
    if (profile.storeId == null) return []
    filters.push(eq(cashCloseouts.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(cashCloseouts.storeId, storeId))
  }

  if (query.from) filters.push(gte(cashCloseouts.createdAt, new Date(String(query.from))))
  if (query.to) filters.push(lt(cashCloseouts.createdAt, new Date(String(query.to))))
  if (query.q) filters.push(ilike(cashCloseouts.note, `%${String(query.q)}%`))

      const where = filters.length ? and(...filters) : undefined
    
      const paginate = query.page != null
      const page = Math.max(1, Number(query.page) || 1)
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.cashCloseouts.findMany({
    where,
    orderBy: [desc(cashCloseouts.createdAt)],
       ...(paginate
      ? { limit: pageSize, offset: (page - 1) * pageSize }
      : { limit: 200, offset: 0 }),
    limit: 200,
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } }
    }
  })

  const mapped = rows.map((c) => ({
    id: c.id,
    storeId: c.storeId,
    storeCode: c.store?.code ?? null,
    storeName: c.store?.name ?? null,
    createdByName: c.createdBy?.fullName ?? null,
    periodFrom: c.periodFrom,
    periodTo: c.periodTo,
    salesCount: c.salesCount,
    totalEmitido: c.totalEmitido,
    totalEfectivo: c.totalEfectivo,
    totalTarjeta: c.totalTarjeta,
    totalTransferencia: c.totalTransferencia,
    voidedCount: c.voidedCount,
    totalVoided: c.totalVoided,
    note: c.note,
    createdAt: c.createdAt
  }))

   if (!paginate) return mapped
  
    const [{ value: totalCount }] = await db
      .select({ value: count() })
      .from(cashCloseouts)
      .where(where)
  
    return {
      data: mapped,
      total: totalCount,
      page,
      pageSize
    }
})