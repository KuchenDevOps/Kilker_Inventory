// ───────────────────────────────────────────────
//  GET /api/expenses — historial de gastos con líneas y estado de pago
// ───────────────────────────────────────────────
import { and, count, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { expenses, expenseItems, expensePayments, tickets } from '../../db/schema'

function toDateOnly(v: unknown): string | null {
  const s = String(v ?? '')
  const match = s.match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)
  const db = useDb()

  // Declarados arriba porque el filtro de `paidBy` puede cortar temprano con
  // un resultado vacío y necesita saber si la respuesta va envuelta o no.
  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))
  const emptyTotals = {
    issuedCount: 0,
    subtotal: 0,
    iva: 0,
    totalToPay: 0,
    voidedCount: 0,
    voidedSubtotal: 0
  }
  const emptyResult = () =>
    paginate ? { data: [], total: 0, page, pageSize, totals: emptyTotals } : []

  const filters = []
  if (isStoreScopedRole(profile.role)) {
    if (profile.storeId == null) return emptyResult()
    filters.push(eq(expenses.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(expenses.storeId, storeId))
  }

  const typeParam = String(query.type ?? '').trim()
  if (typeParam === 'Fijo' || typeParam === 'Operativo') {
    filters.push(eq(expenses.type, typeParam))
  }

  const fromDate = toDateOnly(query.from)
  const toDate = toDateOnly(query.to)
  if (fromDate) filters.push(gte(expenses.paidAt, fromDate))
  if (toDate) filters.push(lt(expenses.paidAt, toDate))

  // ─── Búsqueda: proveedor, número de factura, o concepto de alguna línea ───
  const q = String(query.q ?? '').trim()
  if (q) {
    const like = `%${q}%`

    // Resolvemos el match de "reason" en items como una consulta aparte,
    // en vez de un EXISTS correlacionado crudo (incompatible con el modo
    // relacional de db.query, que re-aliasea las tablas y rompe la referencia).
    const matchingItemRows = await db
      .select({ expenseId: expenseItems.expenseId })
      .from(expenseItems)
      .where(ilike(expenseItems.reason, like))

    const matchingExpenseIds = [...new Set(matchingItemRows.map((r) => r.expenseId))]

    const searchConditions = [ilike(expenses.supplier, like), ilike(expenses.supplierInvoiceNumber, like)]
    if (matchingExpenseIds.length) {
      searchConditions.push(inArray(expenses.id, matchingExpenseIds))
    }
    filters.push(or(...searchConditions)!)
  }
  // ─── fin del bloque de búsqueda ───

  // ─── Filtro por quién pagó (expense_payments.paid_by) ───
  // Filtro aparte de `?q` a propósito: buscar "quién pagó" es una pregunta
  // distinta de buscar proveedor/factura/concepto, y mezclarlas daría falsos
  // positivos (una empresa puede ser a la vez proveedor y pagadora).
  // Se resuelve como consulta previa, no como EXISTS correlacionado, por la
  // misma razón que el match de `reason`: el modo relacional de db.query
  // re-aliasea las tablas y rompe la referencia.
  const paidBy = String(query.paidBy ?? '').trim()
  if (paidBy) {
    const payerRows = await db
      .select({ expenseId: expensePayments.expenseId })
      .from(expensePayments)
      .where(ilike(expensePayments.paidBy, `%${paidBy}%`))

    const payerExpenseIds = [...new Set(payerRows.map((r) => r.expenseId))]
    // Nadie con ese nombre pagó nada: resultado vacío, sin ir a la BD otra vez.
    if (payerExpenseIds.length === 0) return emptyResult()
    filters.push(inArray(expenses.id, payerExpenseIds))
  }

  const whereClause = filters.length ? and(...filters) : undefined

  const rows = await db.query.expenses.findMany({
    where: whereClause,
    orderBy: [desc(expenses.paidAt)],
    ...(paginate ? { limit: pageSize, offset: (page - 1) * pageSize } : {}),
    with: {
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } },
      payments: { columns: { amount: true, paidBy: true } },
      items: { columns: { id: true, reason: true, amount: true } }
    }
  })

  // Tickets de corrección ABIERTOS contra estos gastos: la pantalla los marca
  // como "corrección solicitada" y esconde el botón de pedir otra. Mismo
  // patrón que `pendingCorrection` en ventas y entradas.
  const expenseIds = rows.map((r) => r.id)
  const pending = new Set<number>()
  if (expenseIds.length) {
    const open = await db
      .select({ expenseId: tickets.expenseId })
      .from(tickets)
      .where(and(eq(tickets.status, 'abierto'), inArray(tickets.expenseId, expenseIds)))
    for (const t of open) if (t.expenseId != null) pending.add(t.expenseId)
  }

  const mapped = rows.map((e) => {
    // ⚠️ `subtotal`, `iva` y `totalToPay` se LEEN de la fila; no se recalculan
    // aquí. `iva` y `total_to_pay` son columnas generadas por Postgres
    // (subtotal + IVA − retenciones), y ese es justo el punto: cuando esta
    // pantalla derivaba el IVA por su cuenta y el endpoint de abonos usaba otra
    // fórmula, las dos divergieron y entraron pagos inflados. Una sola
    // definición, y vive en la base.
    const subtotal = Math.round(Number(e.amount) * 100) / 100
    const iva = Math.round(Number(e.iva) * 100) / 100
    const totalToPay = Math.round(Number(e.totalToPay) * 100) / 100
    const totalPaid = Math.round(e.payments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100
    const balance = Math.max(0, Math.round((totalToPay - totalPaid) * 100) / 100)

    // `anulada` gana sobre el resto, igual que en ventas y entradas: anular el
    // gasto borra sus abonos, así que sin esta rama un gasto corregido
    // reaparecería como "pendiente" y alguien iría a pagarlo otra vez.
    let paymentStatus: 'pendiente' | 'parcial' | 'pagado' | 'anulada' = 'pendiente'
    if (e.status === 'anulado') paymentStatus = 'anulada'
    else if (totalPaid >= totalToPay && totalToPay > 0) paymentStatus = 'pagado'
    else if (totalPaid > 0) paymentStatus = 'parcial'

    // Quién(es) pagaron este gasto, sin repetir. Un gasto en parcialidades
    // puede haber sido cubierto por varias empresas.
    const payers = [...new Set(e.payments.map((p) => p.paidBy).filter(Boolean))]

    return {
      id: e.id,
      storeId: e.storeId,
      storeCode: e.store?.code ?? null,
      storeName: e.store?.name ?? null,
      supplier: e.supplier,
      supplierInvoiceNumber: e.supplierInvoiceNumber,
      type: e.type,
      items: e.items,
      itemCount: e.items.length,
      subtotal,
      iva,
      retentionIva: e.retentionIva,
      retentionIsr: e.retentionIsr,
      amount: e.amount,
      totalToPay,
      totalPaid,
      balance,
      paymentStatus,
      payers,
      paidAt: e.paidAt,
      note: e.note,
      status: e.status,
      voidedAt: e.voidedAt,
      voidReason: e.voidReason,
      pendingCorrection: pending.has(e.id),
      createdByName: e.createdBy?.fullName ?? null,
      createdAt: e.createdAt
    }
  })

  if (!paginate) return mapped

  // ─── Agregados del filtro COMPLETO, no de la página ───
  // Las tarjetas de /gastos suman todo lo que cumple el filtro; sumar `mapped`
  // daría solo la página visible y cambiaría al paginar.
  //
  // ⚠️ `iva` y `total_to_pay` se SUMAN de las columnas generadas, no se
  // recalculan aquí: es la misma regla que el mapeo de arriba (una sola
  // definición de la tasa, y vive en la base). Los gastos ANULADOS quedan
  // fuera —igual que en el dashboard— y se devuelven aparte para poder decir
  // cuánto quedó excluido.
  const issued = sql`${expenses.status} = 'emitido'`

  const agg = (
    await db
      .select({
        total: count(),
        issuedCount: sql<number>`count(*) filter (where ${issued})::int`,
        subtotal: sql<string>`coalesce(sum(${expenses.amount}) filter (where ${issued}), 0)`,
        iva: sql<string>`coalesce(sum(${expenses.iva}) filter (where ${issued}), 0)`,
        totalToPay: sql<string>`coalesce(sum(${expenses.totalToPay}) filter (where ${issued}), 0)`,
        voidedCount: sql<number>`count(*) filter (where not ${issued})::int`,
        voidedSubtotal: sql<string>`coalesce(sum(${expenses.amount}) filter (where not ${issued}), 0)`
      })
      .from(expenses)
      .where(whereClause)
  )[0]

  const money = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100

  return {
    data: mapped,
    total: agg?.total ?? 0,
    page,
    pageSize,
    totals: {
      issuedCount: Number(agg?.issuedCount ?? 0),
      /** Suma de `amount`: el subtotal, sin IVA ni retenciones. */
      subtotal: money(agg?.subtotal),
      iva: money(agg?.iva),
      /** Lo que realmente se paga: subtotal + IVA − retenciones. */
      totalToPay: money(agg?.totalToPay),
      voidedCount: Number(agg?.voidedCount ?? 0),
      voidedSubtotal: money(agg?.voidedSubtotal)
    }
  }
})