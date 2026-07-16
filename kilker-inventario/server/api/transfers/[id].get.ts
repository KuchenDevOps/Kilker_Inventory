// ───────────────────────────────────────────────
//  GET /api/transfers/:id — detalle de transferencia
// ───────────────────────────────────────────────
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { stockMovements, transfers } from '../../db/schema'

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const db = useDb()
  const transfer = await db.query.transfers.findFirst({
    where: eq(transfers.id, id),
    with: {
      fromStore: { columns: { code: true, name: true } },
      toStore: { columns: { code: true, name: true } },
      createdBy: { columns: { fullName: true } },
      items: { with: { product: { columns: { name: true, sku: true, unit: true } } } }
    }
  })
  if (!transfer) throw createError({ statusCode: 404, statusMessage: 'Transferencia no existe' })

  if (
    profile.role === 'empleado' &&
    profile.storeId !== transfer.fromStoreId &&
    profile.storeId !== transfer.toStoreId
  ) {
    throw createError({ statusCode: 403, statusMessage: 'No puedes ver esta transferencia' })
  }

  const outboundMovs = await db.query.stockMovements.findMany({
    where: and(eq(stockMovements.transferId, id), eq(stockMovements.type, 'transferencia_salida'))
  })
  const unitValueByProduct = new Map(outboundMovs.map((m) => [m.productId, m.unitValue]))

  return {
    id: transfer.id,
    fromStoreId: transfer.fromStoreId,
    fromStoreCode: transfer.fromStore?.code ?? null,
    fromStoreName: transfer.fromStore?.name ?? null,
    toStoreId: transfer.toStoreId,
    toStoreCode: transfer.toStore?.code ?? null,
    toStoreName: transfer.toStore?.name ?? null,
    status: transfer.status,
    note: transfer.note,
    createdByName: transfer.createdBy?.fullName ?? null,
    itemCount: transfer.items.length,
    totalValue:
      Math.round(
        transfer.items.reduce(
          (sum, it) => sum + Number(unitValueByProduct.get(it.productId) ?? 0) * Number(it.quantity),
          0
        ) * 100
      ) / 100,
    createdAt: transfer.createdAt,
    receivedAt: transfer.receivedAt,
    canceledAt: transfer.canceledAt,
    cancelReason: transfer.cancelReason,
    items: transfer.items.map((it) => ({
      id: it.id,
      productId: it.productId,
      productName: it.product?.name ?? null,
      productSku: it.product?.sku ?? null,
      unit: it.product?.unit ?? null,
      quantity: it.quantity,
      unitValue: unitValueByProduct.get(it.productId) ?? '0'
    }))
  }
})