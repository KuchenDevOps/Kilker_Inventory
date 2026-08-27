// ───────────────────────────────────────────────
//  GET /api/sales/:id/payments — abonos de una venta
// ───────────────────────────────────────────────
import { desc, eq } from 'drizzle-orm'
import { useDb } from '../../../../db'
import { invoices, salePayments } from '../../../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const invoiceId = Number(getRouterParam(event, 'id'))
  if (!invoiceId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const db = useDb()

  // Se lee la factura antes que los abonos para que el rol acotado solo vea
  // los de su sucursal (mismo criterio que /api/movements/:id/payments).
  const invoice = await db.query.invoices.findFirst({
    where: eq(invoices.id, invoiceId),
    columns: { id: true, storeId: true }
  })
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'Venta no existe' })
  if (isStoreScopedRole(profile.role) && invoice.storeId !== profile.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No puedes ver los pagos de ventas de otra sucursal'
    })
  }

  const rows = await db.query.salePayments.findMany({
    where: eq(salePayments.invoiceId, invoiceId),
    orderBy: [desc(salePayments.paidAt)],
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
    invoiceId: p.invoiceId,
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
