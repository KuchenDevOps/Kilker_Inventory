import { desc, eq } from 'drizzle-orm'
import { useDb } from '../../../db'
import { stockMovementEdits, stockMovements } from '../../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const movementId = Number(getRouterParam(event, 'id'))
  if (!movementId) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const db = useDb()

  const movement = await db.query.stockMovements.findFirst({
    where: eq(stockMovements.id, movementId),
    columns: { id: true, storeId: true, type: true, quantity: true }
  })
  if (!movement || movement.type !== 'entrada') {
    throw createError({ statusCode: 404, statusMessage: 'Entrada no existe' })
  }
  if (isStoreScopedRole(profile.role) && movement.storeId !== profile.storeId) {
    throw createError({
      statusCode: 403,
      statusMessage: 'No puedes ver las correcciones de entradas de otra sucursal'
    })
  }

  const rows = await db.query.stockMovementEdits.findMany({
    where: eq(stockMovementEdits.movementId, movementId),
    orderBy: [desc(stockMovementEdits.editedAt)],
    with: { editedBy: { columns: { fullName: true } } }
  })

  const quantity = Number(movement.quantity)

  return rows.map((e) => ({
    id: e.id,
    movementId: e.movementId,
    prevUnitValue: e.prevUnitValue,
    newUnitValue: e.newUnitValue,
    prevTotalValue: String(Math.round(Number(e.prevUnitValue) * quantity * 1e6) / 1e6),
    newTotalValue: String(Math.round(Number(e.newUnitValue) * quantity * 1e6) / 1e6),
    prevSupplierInvoiceNumber: e.prevSupplierInvoiceNumber,
    newSupplierInvoiceNumber: e.newSupplierInvoiceNumber,
    prevSupplierInvoiceDate: e.prevSupplierInvoiceDate,
    newSupplierInvoiceDate: e.newSupplierInvoiceDate,
    reason: e.reason,
    editedByName: e.editedBy?.fullName ?? null,
    editedAt: e.editedAt
  }))
})
