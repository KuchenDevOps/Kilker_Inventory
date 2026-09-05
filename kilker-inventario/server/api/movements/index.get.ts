import { and, count, desc, eq, ilike, inArray, max, or, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { products, profiles, stockMovementEdits, stockMovements, stores, tickets } from '../../db/schema'
import { getEntriesRemainingUnits } from '../../utils/inventoryFifo'
import { effectiveMovementDateBetween, effectiveMovementDateSql } from '../../utils/movementDates'


export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const query = getQuery(event)
  const db = useDb()

  const filters = [eq(stockMovements.type, 'entrada')]

  if (isStoreScopedRole(profile.role)) {
    if (profile.storeId == null) {
      return query.page ? { data: [], total: 0, page: 1, pageSize: 100 } : []
    }
    filters.push(eq(stockMovements.storeId, profile.storeId))
  } else if (query.storeId) {
    const storeId = Number(query.storeId)
    if (storeId) filters.push(eq(stockMovements.storeId, storeId))
  }

  // Fecha EFECTIVA: `supplier_invoice_date` es NULL en las entradas sin
  // factura de proveedor, y compararla a secas las hacía desaparecer del
  // listado en cuanto se elegía un periodo. Misma regla que el dashboard.
  const fromDate = query.from ? new Date(String(query.from)).toISOString().slice(0, 10) : null
  const toDate = query.to ? new Date(String(query.to)).toISOString().slice(0, 10) : null
  filters.push(...effectiveMovementDateBetween(fromDate, toDate))

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
    // Se ordena por la fecha efectiva, no por `supplier_invoice_date`: en un
    // DESC Postgres pone los NULL primero, así que las entradas sin factura
    // de proveedor se quedaban clavadas arriba del listado para siempre.
    orderBy: [desc(effectiveMovementDateSql()), desc(stockMovements.createdAt)],
    ...(paginate ? { limit: pageSize, offset: (page - 1) * pageSize } : {}),
    with: {
      product: { columns: { name: true, sku: true, unit: true } },
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } },
      payments: { columns: { amount: true } }
    }
  })
    const movementIds = rows.map((m) => m.id)
  const voided = new Set<number>()
  // Entradas con ticket de corrección abierto: la UI esconde el botón de
  // solicitar otro y muestra "pendiente" (mismo criterio que /api/sales).
  const pendingCorrection = new Set<number>()
  const editsByMovement = new Map<number, { count: number; lastEditAt: Date | null }>()
  if (movementIds.length) {
    const [reversals, openTickets, edits] = await Promise.all([
      db
        .select({ reversesMovementId: stockMovements.reversesMovementId })
        .from(stockMovements)
        .where(and(eq(stockMovements.type, 'anulacion'), inArray(stockMovements.reversesMovementId, movementIds))),
      db
        .select({ movementId: tickets.movementId })
        .from(tickets)
        .where(and(eq(tickets.status, 'abierto'), inArray(tickets.movementId, movementIds))),
      db
        .select({
          movementId: stockMovementEdits.movementId,
          count: count(),
          lastEditAt: max(stockMovementEdits.editedAt)
        })
        .from(stockMovementEdits)
        .where(inArray(stockMovementEdits.movementId, movementIds))
        .groupBy(stockMovementEdits.movementId)
    ])
    for (const r of reversals) if (r.reversesMovementId != null) voided.add(r.reversesMovementId)
    for (const t of openTickets) if (t.movementId != null) pendingCorrection.add(t.movementId)
    for (const e of edits) {
      editsByMovement.set(e.movementId, { count: Number(e.count), lastEditAt: e.lastEditAt ?? null })
    }
  }

  const remainingUnits = paginate
    ? await getEntriesRemainingUnits(
        db,
        rows
          .filter((m) => !voided.has(m.id))
          .map((m) => ({ id: m.id, productId: m.productId, storeId: m.storeId }))
      )
    : new Map<number, number>()

  const mapped = rows.map((m) => {
    
    const isVoided = voided.has(m.id)
    const totalToPay = Math.round(Number(m.totalValue) * 100) / 100
    const totalPaid = Math.round(m.payments.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100
    const balance = Math.max(0, Math.round((totalToPay - totalPaid) * 100) / 100)

    
    let paymentStatus: 'pendiente' | 'parcial' | 'pagado' | 'anulada' = 'pendiente'
    if (isVoided) paymentStatus = 'anulada'
   
    else if (totalPaid >= totalToPay) paymentStatus = 'pagado'
    else if (totalPaid > 0) paymentStatus = 'parcial'

    return {
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
      voided: isVoided,
      pendingCorrection: pendingCorrection.has(m.id),
      editable: !isVoided && (remainingUnits.get(m.id) ?? 0) >= Number(m.quantity) - 0.0005,
      editCount: editsByMovement.get(m.id)?.count ?? 0,
      lastEditAt: editsByMovement.get(m.id)?.lastEditAt ?? null,
      totalToPay,
      totalPaid,
      balance,
      paymentStatus
    }
  })

  if (!paginate) return mapped // ← comportamiento original, usa el dashboard

  // ─── Agregados del filtro COMPLETO, no de la página ───
  // La tarjeta de totales suma todo lo que cumple el filtro; sumar `mapped`
  // daría solo la página visible. Va junto al `count()` de paginación.
  //
  // ⚠️ Anulada no es una columna: una entrada lo está si existe una `anulacion`
  // que la revierte (kardex append-only, ver §10.2). El mismo criterio que usa
  // `voided` arriba, pero aplicado a TODO el filtro, no a los ids de la página.
  const notVoided = sql`not exists (
    select 1 from stock_movements rev
    where rev.type = 'anulacion' and rev.reverses_movement_id = stock_movements.id
  )`

  const agg = (
    await db
      .select({
        total: count(),
        activeCount: sql<number>`count(*) filter (where ${notVoided})::int`,
        // Costo limpio de la entrada (`total_value`): sin IVA ni retenciones.
        activeAmount: sql<string>`coalesce(sum(${stockMovements.totalValue}) filter (where ${notVoided}), 0)`,
        voidedCount: sql<number>`count(*) filter (where not ${notVoided})::int`,
        voidedAmount: sql<string>`coalesce(sum(${stockMovements.totalValue}) filter (where not ${notVoided}), 0)`
      })
      .from(stockMovements)
      .where(whereClause)
  )[0]

  return {
    data: mapped,
    total: agg?.total ?? 0,
    page,
    pageSize,
    totals: {
      activeCount: Number(agg?.activeCount ?? 0),
      activeAmount: Math.round(Number(agg?.activeAmount ?? 0) * 100) / 100,
      voidedCount: Number(agg?.voidedCount ?? 0),
      voidedAmount: Math.round(Number(agg?.voidedAmount ?? 0) * 100) / 100
    }
  }
})