// ───────────────────────────────────────────────
//  GET /api/movements/:id/payments — abonos de una entrada
// ───────────────────────────────────────────────
import { desc, eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { entryPayments, stockMovements } from '../../../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const movementId = Number(getRouterParam(event, 'id'))
  if (!movementId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const db = useDb()

  // La FK no puede exigir que sea una entrada; se valida aquí. De paso, el
  // empleado solo ve los abonos de su sucursal.
  const movement = await db.query.stockMovements.findFirst({
    where: eq(stockMovements.id, movementId),
    columns: { id: true, storeId: true, type: true }
  })
  if (!movement || movement.type !== 'entrada') {
    throw createError({ statusCode: 404, statusMessage: 'Entrada no existe' })
  }
  if (isStoreScopedRole(profile.role) && movement.storeId !== profile.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No puedes ver los pagos de entradas de otra sucursal'
    })
  }

  const rows = await db.query.entryPayments.findMany({
    where: eq(entryPayments.movementId, movementId),
    orderBy: [desc(entryPayments.paidAt)],
    with: {
      createdBy: { columns: { fullName: true } },
      // ⚠️ `accountId` sale del mapeo manual de abajo. Se devuelve SIEMPRE, junto
      // con la etiqueta: sin él, la pantalla no puede distinguir un pago en
      // efectivo de uno bancario al que todavía no se le asigna cuenta — y los
      // dos se ven igual (null) desde el cliente.
      account: { columns: { bank: true, owner: true, cardLast4: true } }
    }
  })

  return rows.map((p) => ({
    id: p.id,
    movementId: p.movementId,
    amount: p.amount,
    paidAt: p.paidAt,
    method: p.method,
    accountId: p.accountId,
    accountLabel: p.account
      ? p.account.cardLast4
        ? `${p.account.bank} ···· ${p.account.cardLast4}`
        : `${p.account.bank} · ${p.account.owner}`
      : null,
    note: p.note,
    createdByName: p.createdBy?.fullName ?? null,
    createdAt: p.createdAt
  }))
})
