import { and, count, desc, eq, gte, ilike, inArray, lt } from 'drizzle-orm'
import { useDb } from '../../db'
import { cashCloseouts } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)

  const db = useDb()

  const filters = []
  if (isStoreScopedRole(profile.role)) {
    if (profile.storeId == null) return []
    filters.push(eq(cashCloseouts.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(cashCloseouts.storeId, storeId))
  }

  // ⚠️ El periodo se filtra por `period_to` (el CIERRE del corte), no por
  // `created_at` (la captura). Desde que el admin puede elegir la fecha de
  // cierre, los dos ya no coinciden: un corte del lunes capturado el martes
  // tiene que aparecer al filtrar por lunes, que es lo que el usuario busca.
  // Para los cortes históricos no cambia nada — ahí cierre y captura son el
  // mismo instante.
  if (query.from) filters.push(gte(cashCloseouts.periodTo, new Date(String(query.from))))
  if (query.to) filters.push(lt(cashCloseouts.periodTo, new Date(String(query.to))))
  if (query.q) filters.push(ilike(cashCloseouts.note, `%${String(query.q)}%`))

      const where = filters.length ? and(...filters) : undefined
    
      const paginate = query.page != null
      const page = Math.max(1, Number(query.page) || 1)
      const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.cashCloseouts.findMany({
    where,
    // Mismo motivo que el filtro: se ordena por el cierre, para que un corte
    // retroactivo no salga arriba con la fecha de otro día. El `id` desempata
    // igual que en `latestCloseoutOrder` (ver server/utils/cortes.ts).
    orderBy: [desc(cashCloseouts.periodTo), desc(cashCloseouts.id)],
    // ⚠️ El `limit: 200` que estaba aquí abajo pisaba el `pageSize` del spread
    // (la última llave gana): la página 1 traía 200 filas y `UPagination`
    // paginaba sobre una lista que ya venía de más.
    ...(paginate
      ? { limit: pageSize, offset: (page - 1) * pageSize }
      : { limit: 200, offset: 0 }),
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } }
    }
  })

  // ───────────────────────────────────────────────
  //  `isLatest`: quién es el último corte de su sucursal
  // ───────────────────────────────────────────────
  // Lo decide el SERVIDOR porque es la misma regla que aplica el DELETE (solo se
  // borra el último de la tienda, para no dejar periodos huérfanos). La pantalla
  // no puede deducirlo de la lista que recibe: viene paginada y filtrada, así
  // que el primer corte de una tienda en la página 2 —o con un filtro de
  // periodo puesto— no es el último de esa tienda, y el botón de borrar
  // aparecería donde el servidor va a responder 409.
  const storeIds = [...new Set(rows.map((c) => c.storeId))]
  const latestIds = new Set<number>()
  if (storeIds.length) {
    const latest = await db
      .selectDistinctOn([cashCloseouts.storeId], {
        storeId: cashCloseouts.storeId,
        id: cashCloseouts.id
      })
      .from(cashCloseouts)
      // Sin filtros: el último de la tienda es el último de TODO el historial,
      // no el último de esta página ni el del periodo filtrado.
      .where(inArray(cashCloseouts.storeId, storeIds))
      .orderBy(cashCloseouts.storeId, desc(cashCloseouts.periodTo), desc(cashCloseouts.id))
    for (const r of latest) latestIds.add(r.id)
  }

  const mapped = rows.map((c) => ({
    id: c.id,
    isLatest: latestIds.has(c.id),
    storeId: c.storeId,
    storeCode: c.store?.code ?? null,
    storeName: c.store?.name ?? null,
    createdByName: c.createdBy?.fullName ?? null,
    periodFrom: c.periodFrom,
    periodTo: c.periodTo,
    salesCount: c.salesCount,
    totalEmitido: c.totalEmitido,
    totalEfectivo: c.totalEfectivo,
    totalDebito: c.totalDebito,
    totalCredito: c.totalCredito,
    totalTransferencia: c.totalTransferencia,
    voidedCount: c.voidedCount,
    totalVoided: c.totalVoided,
    note: c.note,
    createdAt: c.createdAt
  }))

   if (!paginate) return mapped
  
    const totalCount =
      (await db.select({ value: count() }).from(cashCloseouts).where(where))[0]?.value ?? 0
  
    return {
      data: mapped,
      total: totalCount,
      page,
      pageSize
    }
})