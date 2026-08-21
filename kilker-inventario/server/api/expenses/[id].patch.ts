// ───────────────────────────────────────────────
//  PATCH /api/expenses/:id — editar gasto y sus líneas de concepto
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { expenses, expenseItems, stores } from '../../db/schema'

const IVA_RATE = 0.16

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

  let retentionIva: number | null | undefined = undefined
  if (body.retentionIva !== undefined) {
    retentionIva = Number(body.retentionIva)
    if (!Number.isFinite(retentionIva) || retentionIva < 0) {
      throw createError({ statusCode: 400, statusMessage: 'retentionIva inválido' })
    }
    values.retentionIva = String(retentionIva)
  }

  let retentionIsr: number | null | undefined = undefined
  if (body.retentionIsr !== undefined) {
    retentionIsr = Number(body.retentionIsr)
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

      return { ...expense, items }
    })

    return updated
  } catch (error) {
    console.error('Error updating expense:', error)
    throw createError({ statusCode: 500, statusMessage: 'Error al actualizar el gasto' })
  }
})