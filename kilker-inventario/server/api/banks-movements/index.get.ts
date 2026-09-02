// ───────────────────────────────────────────────
//  GET /api/banks-movements — libro de dinero + saldo por cuenta
// ───────────────────────────────────────────────
// Lista `banks_movements` (lo que asientan los pagos y lo que se captura a mano)
// y devuelve los saldos.
//
// ⚠️ Admin, observador y admin_tienda. El saldo bancario de la empresa no es un
// dato de la operación diaria de mostrador: un empleado necesita el catálogo de
// cuentas para elegir de dónde salió un pago (por eso `GET /api/bank-accounts`
// sí es para todos), pero no el flujo completo de dinero.
//
// ⚠️ `admin_tienda` es un rol ACOTADO A SU SUCURSAL en todo lo demás, y aquí NO
// lo es: ve el flujo y los saldos de toda la empresa. No es un descuido de
// scoping, es que el saldo no se puede acotar — vive por CUENTA BANCARIA, y una
// cuenta no pertenece a ninguna sucursal (`store_id` en `banks_movements` es
// procedencia informativa, no una partición del dinero). Filtrar por su tienda
// daría un número que no es el saldo de nada. Si algún día hace falta que el
// administrador de sucursal NO vea el dinero global, la salida no es filtrar
// esto: es quitarle el acceso al dashboard de flujo.
//
// ⚠️ SIEMPRE responde envuelto (`{data,total,...}`), aunque no se mande `?page`.
// Es distinto del resto de los listados a propósito: `GET /api/sales` recorta a
// 200 filas en silencio cuando no hay `?page` y devuelve un arreglo que PARECE
// completo — de ahí salieron exportaciones truncadas. Aquí no hay forma de
// confundir "todo" con "la primera página", y los saldos viajan siempre.
//
// ⚠️ `balances` NO respeta los filtros, y es a propósito: el saldo de una cuenta
// es su historia completa. Un saldo recalculado sobre "agosto" no es un saldo,
// es un neto del periodo — eso es `filteredNet`, que va aparte y se llama
// distinto para que nadie los confunda.
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { banksMovements, cashFlowType } from '../../db/schema'

function toDateOnly(v: unknown): string | null {
  const match = String(v ?? '').match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

/** De qué viene el movimiento, ya resuelto para la UI. */
function sourceOf(row: {
  salePaymentId: number | null
  entryPaymentId: number | null
  expensePaymentId: number | null
  reversesId: number | null
}): 'venta' | 'entrada' | 'gasto' | 'anulacion' | 'manual' {
  if (row.salePaymentId != null) return 'venta'
  if (row.entryPaymentId != null) return 'entrada'
  if (row.expensePaymentId != null) return 'gasto'
  if (row.reversesId != null) return 'anulacion'
  // ⚠️ Sin liga y sin reversa NO siempre es manual: anular una venta borra sus
  // abonos y la FK queda en `set null` (ver schema.ts), así que el movimiento
  // original se queda huérfano. Por eso el `type` manda sobre la ausencia de
  // ligas; el folio del documento sobrevive en `note`.
  return 'manual'
}

/**
 * Clasificaciones que solo nacen de una captura manual.
 *
 * ⚠️ `movimiento` es la del concepto libre, y es la que más se va a usar: si se
 * olvida aquí, el filtro "solo capturados a mano" esconde justo lo que el
 * usuario acaba de escribir.
 */
const MANUAL_TYPES = new Set(['saldo_inicial', 'prestamo', 'retiro', 'ajuste', 'movimiento'])

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: ['admin', 'observador', 'admin_tienda'] })
  const query = getQuery(event)
  const db = useDb()

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 100))

  const filters = []

  // `account`: id de cuenta, o 'cash' para la bolsa de efectivo. Se distingue de
  // "sin filtro" porque efectivo es `account_id IS NULL`, y un `?account=` vacío
  // no puede significar las dos cosas.
  const accountParam = String(query.account ?? '').trim()
  if (accountParam === 'cash') {
    filters.push(isNull(banksMovements.accountId))
  } else if (accountParam) {
    const accountId = Number(accountParam)
    if (accountId) filters.push(eq(banksMovements.accountId, accountId))
  }

  const typeParam = String(query.type ?? '').trim()
  if (cashFlowType.enumValues.includes(typeParam as never)) {
    filters.push(eq(banksMovements.type, typeParam as (typeof cashFlowType.enumValues)[number]))
  }

  // `source=manual` es lo que hace útil la pantalla de captura: "enséñame solo lo
  // que se metió a mano". Se resuelve por `type` y no por "no tiene ligas",
  // porque un movimiento de pago cuyo abono se borró al anular el documento
  // también se queda sin ligas (FK `set null`) y no es manual.
  const sourceParam = String(query.source ?? '').trim()
  if (sourceParam === 'manual') {
    filters.push(inArray(banksMovements.type, [...MANUAL_TYPES] as never[]))
  } else if (sourceParam === 'documento') {
    filters.push(
      inArray(banksMovements.type, ['cobro_venta', 'pago_entrada', 'pago_gasto'] as never[])
    )
  }

  const storeParam = Number(query.storeId ?? 0)
  if (storeParam) filters.push(eq(banksMovements.storeId, storeParam))

  const fromDate = toDateOnly(query.from)
  const toDate = toDateOnly(query.to)
  if (fromDate) filters.push(gte(banksMovements.occurredAt, fromDate))
  // `to` EXCLUSIVO, igual que en gastos y en la valuación de inventario.
  if (toDate) filters.push(lt(banksMovements.occurredAt, toDate))

  // `concept`: coincidencia EXACTA del concepto (sin distinguir mayúsculas), no
  // la búsqueda parcial de `?q`. Es lo que permite totalizar un concepto
  // concreto —"Saldo inicial"— sin que un "Saldo inicial corregido" se cuele en
  // la suma.
  const conceptParam = String(query.concept ?? '').trim()
  if (conceptParam) {
    filters.push(sql`lower(${banksMovements.concept}) = lower(${conceptParam})`)
  }

  // Busca en los DOS textos: el concepto que escribió el usuario y la nota
  // (que en los movimientos de un pago es donde vive el folio del documento).
  const q = String(query.q ?? '').trim()
  if (q) {
    const like = `%${q}%`
    filters.push(or(ilike(banksMovements.note, like), ilike(banksMovements.concept, like))!)
  }

  const whereClause = filters.length ? and(...filters) : undefined

  const rows = await db.query.banksMovements.findMany({
    where: whereClause,
    // Por fecha del movimiento, e `id` desc para desempatar: varios movimientos
    // del mismo día son la norma y sin el segundo criterio el orden entre ellos
    // queda al capricho del planner (y cambia entre páginas).
    orderBy: [desc(banksMovements.occurredAt), desc(banksMovements.id)],
    ...(paginate ? { limit: pageSize, offset: (page - 1) * pageSize } : {}),
    with: {
      account: { columns: { bank: true, owner: true, cardLast4: true } },
      store: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } }
    }
  })

  const data = rows.map((m) => ({
    id: m.id,
    type: m.type,
    /** Lo que escribió el usuario. NULL en los movimientos que asienta un pago. */
    concept: m.concept,
    /** numeric → string, con signo (+ entra, − sale). */
    amount: m.amount,
    occurredAt: m.occurredAt,
    accountId: m.accountId,
    accountLabel: m.account
      ? m.account.cardLast4
        ? `${m.account.bank} ···· ${m.account.cardLast4} · ${m.account.owner}`
        : `${m.account.bank} · ${m.account.owner}`
      : null,
    storeId: m.storeId,
    storeCode: m.store?.code ?? null,
    storeName: m.store?.name ?? null,
    method: m.method,
    note: m.note,
    source: sourceOf(m),
    reversesId: m.reversesId,
    createdByName: m.createdBy?.fullName ?? null,
    createdAt: m.createdAt
  }))

  const [totalRow] = await db
    .select({ value: count(), net: sql<string | null>`sum(${banksMovements.amount})` })
    .from(banksMovements)
    .where(whereClause)

  // Saldo por bolsa sobre TODO el libro (ver el encabezado). El efectivo sale
  // como una fila más con `accountId: null`; el saldo global es la suma.
  const balanceRows = await db
    .select({
      accountId: banksMovements.accountId,
      movements: count(),
      balance: sql<string>`sum(${banksMovements.amount})`
    })
    .from(banksMovements)
    .groupBy(banksMovements.accountId)

  const accounts = await db.query.bankAccounts.findMany({
    columns: { id: true, bank: true, owner: true, cardLast4: true, isActive: true }
  })
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const balances = balanceRows
    .map((b) => {
      const account = b.accountId == null ? null : accountById.get(b.accountId)
      return {
        accountId: b.accountId,
        label: account
          ? account.cardLast4
            ? `${account.bank} ···· ${account.cardLast4} · ${account.owner}`
            : `${account.bank} · ${account.owner}`
          : 'Efectivo',
        isActive: account?.isActive ?? true,
        movements: b.movements,
        balance: Math.round(Number(b.balance ?? 0) * 100) / 100
      }
    })
    // Efectivo primero, luego las cuentas por nombre: el orden de un `group by`
    // no está garantizado y la tarjeta de saldos no debe bailar entre recargas.
    .sort((a, b) =>
      a.accountId == null ? -1 : b.accountId == null ? 1 : a.label.localeCompare(b.label)
    )

  // Cuentas que existen pero no tienen un solo movimiento: se muestran en cero en
  // vez de desaparecer, para que se vea que están y les falta el saldo inicial.
  for (const a of accounts) {
    if (balances.some((b) => b.accountId === a.id)) continue
    balances.push({
      accountId: a.id,
      label: a.cardLast4 ? `${a.bank} ···· ${a.cardLast4} · ${a.owner}` : `${a.bank} · ${a.owner}`,
      isActive: a.isActive,
      movements: 0,
      balance: 0
    })
  }

  // Conceptos ya usados, para que el formulario los sugiera. Es lo que evita que
  // el texto libre se convierta en cinco escrituras distintas de "nómina":
  // sugerir lo que ya existe no impide escribir algo nuevo, pero hace que
  // repetir sea más fácil que inventar.
  const conceptRows = await db
    .selectDistinct({ concept: banksMovements.concept })
    .from(banksMovements)
    .where(isNotNull(banksMovements.concept))
    .orderBy(banksMovements.concept)

  // Clasificaciones que de verdad existen en el libro, para que el filtro no
  // ofrezca las que ya no se pueden capturar: `prestamo`, `retiro` y `ajuste`
  // siguen en el enum porque Postgres no sabe quitar valores, pero dejaron de
  // derivarse de ningún concepto (ver `NAMED_CONCEPTS` en el POST). Listarlas
  // sería ofrecer un filtro que nunca devuelve nada.
  const typeRows = await db
    .selectDistinct({ type: banksMovements.type })
    .from(banksMovements)

  return {
    data,
    total: totalRow?.value ?? 0,
    page,
    pageSize,
    concepts: conceptRows.map((r) => r.concept).filter((c): c is string => !!c),
    types: typeRows.map((r) => r.type),
    /** Neto de lo que quedó dentro del filtro. NO es un saldo. */
    filteredNet: Math.round(Number(totalRow?.net ?? 0) * 100) / 100,
    balances,
    globalBalance:
      Math.round(balances.reduce((sum, b) => sum + b.balance, 0) * 100) / 100
  }
})
