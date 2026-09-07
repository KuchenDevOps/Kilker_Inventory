import { and, eq, sql } from 'drizzle-orm'
import { useDb } from '../../../db'
import { IVA_RATE, entryPayments, stockMovementEdits, stockMovements, stores } from '../../../db/schema'
import { isEntryLayerIntact } from '../../../utils/inventoryFifo'

interface EditBody {
  unitValue?: number | string | null
  supplierInvoiceNumber?: string | null
  supplierInvoiceDate?: string | null
  reason?: string | null
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Pagable que TENDRÍA la entrada con este costo: `total_to_pay` = costo + IVA.
 *
 * Se replica aquí —única copia en el servidor— porque la columna generada
 * todavía no existe: la validación corre ANTES del UPDATE, sobre un costo
 * hipotético. La definición que manda sigue siendo la del DDL (`schema.ts`), y
 * por eso la tasa se toma de `IVA_RATE` y el redondeo imita el suyo
 * (`round(total_value, 2) + round(total_value * 0.16, 2)`): con `× 1.16` a secas
 * el guard podía diferir un centavo de lo que la base guarda un renglón después.
 */
const payableOf = (cost: number) => round2(cost) + round2(cost * IVA_RATE)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default defineEventHandler(async (event) => {
  // ⚠️ Corregir una entrada es EXCLUSIVO del admin de la empresa. Antes lo podía
  // hacer cualquiera con permiso de escritura y el único candado era el FIFO
  // (`isEntryLayerIntact`), pero corregir el costo REVALÚA el inventario y la
  // utilidad hacia atrás —lo mismo que anular—, así que va del lado de las
  // anulaciones: el empleado y el administrador de sucursal abren un ticket de
  // corrección y el admin resuelve. El candado del FIFO sigue vivo debajo; ahora
  // son dos, y hay que pasar los dos.
  const profile = await requireProfile(event, { role: 'admin' })
  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID inválido' })

  const body = await readBody<EditBody>(event).catch(() => ({}) as EditBody)
  const wantsUnitValue = body?.unitValue != null && String(body.unitValue).trim() !== ''
  const wantsInvoiceNumber = Object.hasOwn(body ?? {}, 'supplierInvoiceNumber')
  const wantsInvoiceDate = Object.hasOwn(body ?? {}, 'supplierInvoiceDate')

  if (!wantsUnitValue && !wantsInvoiceNumber && !wantsInvoiceDate) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nada que corregir: manda unitValue, supplierInvoiceNumber o supplierInvoiceDate'
    })
  }

  let nextUnitValue: number | null = null
  if (wantsUnitValue) {
    nextUnitValue = round6(Number(body.unitValue))
    if (!Number.isFinite(nextUnitValue) || nextUnitValue < 0) {
      throw createError({ statusCode: 400, statusMessage: 'El costo unitario debe ser un número mayor o igual a 0' })
    }
  }

  let nextInvoiceDate: string | null = null
  if (wantsInvoiceDate) {
    const raw = typeof body.supplierInvoiceDate === 'string' ? body.supplierInvoiceDate.trim() : ''
    nextInvoiceDate = raw || null
    if (nextInvoiceDate && !DATE_RE.test(nextInvoiceDate)) {
      throw createError({ statusCode: 400, statusMessage: 'La fecha de factura debe venir como AAAA-MM-DD' })
    }
  }

  const nextInvoiceNumber = wantsInvoiceNumber
    ? (typeof body.supplierInvoiceNumber === 'string' ? body.supplierInvoiceNumber.trim() || null : null)
    : null

  const reason = typeof body?.reason === 'string' ? body.reason.trim() || null : null

  const db = useDb()

  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ${stores} WHERE id = (SELECT store_id FROM ${stockMovements} WHERE id = ${id}) FOR UPDATE`
    )
    await tx.execute(sql`SELECT id FROM ${stockMovements} WHERE id = ${id} FOR UPDATE`)

    const movement = await tx.query.stockMovements.findFirst({
      where: eq(stockMovements.id, id)
    })
    if (!movement) throw createError({ statusCode: 404, statusMessage: 'Movimiento no existe' })
    if (movement.type !== 'entrada') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Solo se pueden corregir movimientos de tipo "entrada"'
      })
    }
    // Hoy inalcanzable (solo entra `admin`, que es global), pero se conserva a
    // propósito: si algún día se le devuelve la corrección a un rol acotado, el
    // aislamiento por sucursal tiene que seguir puesto sin que nadie lo recuerde.
    if (isStoreScopedRole(profile.role) && movement.storeId !== profile.storeId) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Solo puedes corregir entradas de tu sucursal'
      })
    }

    const reversal = await tx.query.stockMovements.findFirst({
      where: and(
        eq(stockMovements.type, 'anulacion'),
        eq(stockMovements.reversesMovementId, id)
      ),
      columns: { id: true }
    })
    if (reversal) {
      throw createError({ statusCode: 409, statusMessage: 'Esta entrada está anulada: ya no se puede corregir' })
    }

    const intact = await isEntryLayerIntact(tx, {
      id: movement.id,
      productId: movement.productId,
      storeId: movement.storeId,
      quantity: movement.quantity
    })
    if (!intact) {
      throw createError({
        statusCode: 409,
        statusMessage:
          'No se puede corregir: parte de esta entrada ya salió del inventario (venta, transferencia o ajuste). ' +
          'Su costo ya se usó para valuar esas salidas.'
      })
    }

    const quantity = Number(movement.quantity)
    const unitValue = wantsUnitValue ? nextUnitValue! : Number(movement.unitValue)
    const totalValue = round6(unitValue * quantity)
    const invoiceNumber = wantsInvoiceNumber ? nextInvoiceNumber : movement.supplierInvoiceNumber
    const invoiceDate = wantsInvoiceDate ? nextInvoiceDate : movement.supplierInvoiceDate

    const changed =
      unitValue !== Number(movement.unitValue) ||
      invoiceNumber !== movement.supplierInvoiceNumber ||
      invoiceDate !== movement.supplierInvoiceDate

    if (!changed) return { ok: true as const, changed: false as const, movement }

    const paidRows = await tx.query.entryPayments.findMany({
      where: eq(entryPayments.movementId, id),
      columns: { amount: true }
    })
    const totalPaid = round2(paidRows.reduce((sum, p) => sum + Number(p.amount), 0))
    // ⚠️ Se compara contra el PAGABLE (costo + IVA), no contra el costo pelón:
    // el proveedor cobra el 16%, así que abonos de hasta `costo × 1.16` son
    // legítimos y contra `total_value` un costo perfectamente válido rebotaba
    // con 409. Es el mismo pagable que topa los abonos en
    // `payments/index.post.ts`, sólo que sobre el costo que aún no se guarda.
    const nextPayable = payableOf(totalValue)
    if (totalPaid > nextPayable + 0.001) {
      throw createError({
        statusCode: 409,
        statusMessage:
          `No se puede dejar el costo en ${round2(totalValue)} (${round2(nextPayable)} con IVA): ` +
          `ya hay ${totalPaid} pagado(s) a esta entrada. Borra o ajusta los pagos primero.`
      })
    }

    const [updated] = await tx
      .update(stockMovements)
      .set({
        unitValue: String(unitValue),
        totalValue: String(totalValue),
        supplierInvoiceNumber: invoiceNumber,
        supplierInvoiceDate: invoiceDate
      })
      .where(eq(stockMovements.id, id))
      .returning()

    await tx.insert(stockMovementEdits).values({
      movementId: id,
      prevUnitValue: movement.unitValue,
      newUnitValue: String(unitValue),
      prevSupplierInvoiceNumber: movement.supplierInvoiceNumber,
      newSupplierInvoiceNumber: invoiceNumber,
      prevSupplierInvoiceDate: movement.supplierInvoiceDate,
      newSupplierInvoiceDate: invoiceDate,
      reason,
      editedBy: profile.id
    })

    return { ok: true as const, changed: true as const, movement: updated }
  })
})
