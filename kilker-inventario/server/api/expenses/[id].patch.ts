// ───────────────────────────────────────────────
//  PATCH /api/expenses/:id — editar gasto y sus líneas de concepto
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { expenses, expenseItems, expensePayments, stores } from '../../db/schema'


const EXPENSE_TYPES = ['Fijo', 'Operativo'] as const
type ExpenseTypeValue = (typeof EXPENSE_TYPES)[number]

function parseExpenseType(v: unknown): ExpenseTypeValue {
  if (typeof v === 'string' && (EXPENSE_TYPES as readonly string[]).includes(v)) {
    return v as ExpenseTypeValue
  }
  throw createError({ statusCode: 400, statusMessage: 'type inválido (Fijo | Operativo)' })
}

interface ExpenseItemBody {
  reason?: string
  amount?: number | string
}

interface ExpenseUpdateBody {
  storeId?: number
  supplier?: string
  type?: string
  supplierInvoiceNumber?: string
  items?: ExpenseItemBody[]
  retentionIva?: number | string
  retentionIsr?: number | string
  paidAt?: string
  note?: string | null
}

function cleanText(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const id = Number(getRouterParam(event, 'id'))

  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: 'ID inválido' })
  }

  const body = await readBody<ExpenseUpdateBody>(event)
  const db = useDb()

  const existing = await db.query.expenses.findFirst({
    where: eq(expenses.id, id),
    with: { items: true }
  })

  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Gasto no existe' })
  }

  if (isStoreScopedRole(profile.role) && existing.storeId !== profile.storeId) {
    throw createError({ statusCode: 403, statusMessage: 'No puedes editar gastos de otra sucursal' })
  }

  const values: Partial<typeof expenses.$inferInsert> = {}

  if (body.storeId !== undefined) {
    if (profile.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'Solo un admin puede cambiar la sucursal' })
    }
    const storeId = Number(body.storeId)
    if (!storeId || isNaN(storeId)) {
      throw createError({ statusCode: 400, statusMessage: 'storeId inválido' })
    }
    const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
    if (!store) throw createError({ statusCode: 404, statusMessage: 'Sucursal no existe' })
    values.storeId = storeId
  }

  if (body.supplier !== undefined) {
    const supplier = cleanText(body.supplier)
    if (!supplier) throw createError({ statusCode: 400, statusMessage: 'El proveedor no puede quedar vacío' })
    values.supplier = supplier
  }

  if (body.supplierInvoiceNumber !== undefined) {
    const num = cleanText(body.supplierInvoiceNumber)
    if (!num) throw createError({ statusCode: 400, statusMessage: 'El número de factura no puede quedar vacío' })
    values.supplierInvoiceNumber = num
  }

  if (body.type !== undefined) {
    values.type = parseExpenseType(body.type)
  }

  // ─── Líneas de concepto: si vienen, reemplazan por completo las existentes ───
  let newItems: { reason: string; amount: number }[] | null = null
  if (body.items !== undefined) {
    const rawItems = Array.isArray(body.items) ? body.items : []
    newItems = rawItems
      .map((it) => ({ reason: cleanText(it?.reason) ?? '', amount: Number(it?.amount) }))
      .filter((it) => it.reason && Number.isFinite(it.amount) && it.amount > 0)

    if (newItems.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Agrega al menos un concepto con monto válido' })
    }
  }

  if (body.retentionIva !== undefined) {
    const retentionIva = Number(body.retentionIva)
    if (!Number.isFinite(retentionIva) || retentionIva < 0) {
      throw createError({ statusCode: 400, statusMessage: 'retentionIva inválido' })
    }
    values.retentionIva = String(retentionIva)
  }

  if (body.retentionIsr !== undefined) {
    const retentionIsr = Number(body.retentionIsr)
    if (!Number.isFinite(retentionIsr) || retentionIsr < 0) {
      throw createError({ statusCode: 400, statusMessage: 'retentionIsr inválido' })
    }
    values.retentionIsr = String(retentionIsr)
  }

  if (body.paidAt !== undefined) {
    const paidAt = cleanText(body.paidAt)
    if (!paidAt) throw createError({ statusCode: 400, statusMessage: 'La fecha de pago no puede quedar vacía' })
    values.paidAt = paidAt
  }

  if (body.note !== undefined) {
    values.note = cleanText(body.note)
  }
  

  // ─── Recalcular el total si cambiaron items o retenciones ───
    if (newItems) {
    const subtotal = Math.round(newItems.reduce((sum, it) => sum + it.amount, 0) * 100) / 100
    values.amount = String(subtotal)
  }

  if (Object.keys(values).length === 0 && !newItems) {
    throw createError({ statusCode: 400, statusMessage: 'No hay datos para actualizar' })
  }

  try {
    const updated = await db.transaction(async (tx) => {
      let expense = existing
      if (Object.keys(values).length > 0) {
        const [row] = await tx.update(expenses).set(values).where(eq(expenses.id, id)).returning()
        expense = { ...existing, ...row }
      }

      let items = existing.items
      if (newItems) {
        await tx.delete(expenseItems).where(eq(expenseItems.expenseId, id))
        items = await tx
          .insert(expenseItems)
          .values(newItems.map((it) => ({ expenseId: id, reason: it.reason, amount: String(it.amount) })))
          .returning()
      }

      // ⚠️ Editar un gasto ya pagado puede dejarlo pagado DE MÁS: basta bajar un
      // concepto o subir una retención para que el nuevo `total_to_pay` quede
      // por debajo de lo que ya se abonó. Antes daba igual —las retenciones no
      // se pagaban—; ahora sí, y el saldo de la cuenta ya movió ese dinero.
      //
      // Se compara contra el `total_to_pay` que devolvió el UPDATE, o sea el que
      // acaba de calcular Postgres: volver a derivarlo aquí reintroduciría la
      // segunda fórmula que causó los pagos inflados. El throw revierte la
      // transacción entera, edición incluida.
      const paidRows = await tx.query.expensePayments.findMany({
        where: eq(expensePayments.expenseId, id),
        columns: { amount: true }
      })
      const totalPaid = paidRows.reduce((sum, p) => sum + Number(p.amount), 0)
      const totalToPay = Number(expense.totalToPay)
      if (totalPaid > totalToPay + 0.01) {
        throw createError({
          statusCode: 400,
          statusMessage:
            `No se puede dejar el gasto en ${totalToPay.toFixed(2)}: ya tiene ` +
            `${totalPaid.toFixed(2)} pagados. Cancela o ajusta los abonos primero.`
        })
      }

      return { ...expense, items }
    })

    return updated
  } catch (error) {
    // Un error de validación de adentro de la transacción (p. ej. "ya tiene N
    // pagados") es del usuario, no del servidor: hay que dejarlo salir tal cual.
    // Envolverlo en un 500 genérico le quitaba el mensaje y dejaba al usuario
    // sin saber qué corregir.
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    console.error('Error updating expense:', error)
    throw createError({ statusCode: 500, statusMessage: 'Error al actualizar el gasto' })
  }
})