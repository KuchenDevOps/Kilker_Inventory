// ───────────────────────────────────────────────
//  POST /api/expenses — registrar un gasto con líneas de concepto
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

interface NewExpenseItemBody {
  reason?: string
  amount?: number | string
}

interface NewExpenseBody {
  storeId?: number
  supplier?: string
  supplierInvoiceNumber?: string
  type?: string
  items?: NewExpenseItemBody[]
  retentionIva?: number | string
  retentionIsr?: number | string
  paidAt?: string
  note?: string | null
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event)
  const body = await readBody<NewExpenseBody>(event)

  const storeId = profile.role === 'admin' ? Number(body?.storeId) : Number(profile.storeId)
  if (!storeId) {
    throw createError({
      statusCode: 400,
      statusMessage:
        profile.role === 'admin' ? 'storeId es requerido' : 'Tu perfil debe tener una sucursal asignada'
    })
  }

  const supplier = cleanText(body?.supplier)
  const supplierInvoiceNumber = cleanText(body?.supplierInvoiceNumber)
  if (!supplier) throw createError({ statusCode: 400, statusMessage: 'El proveedor es obligatorio' })
  if (!supplierInvoiceNumber) {
    throw createError({ statusCode: 400, statusMessage: 'El número de factura es obligatorio' })
  }

  const type = parseExpenseType(body?.type)

  // ─── Líneas de concepto (equivalente a invoiceItems) ───
  const rawItems = Array.isArray(body?.items) ? body.items : []
  const items = rawItems
    .map((it) => ({ reason: cleanText(it?.reason), amount: Number(it?.amount) }))
    .filter((it) => it.reason && Number.isFinite(it.amount) && it.amount > 0) as {
    reason: string
    amount: number
  }[]

  if (items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Agrega al menos un concepto con monto válido' })
  }

  const retentionIva = body?.retentionIva != null ? Number(body.retentionIva) : null
  if (retentionIva != null && (!Number.isFinite(retentionIva) || retentionIva < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'retentionIva inválido' })
  }
  const retentionIsr = body?.retentionIsr != null ? Number(body.retentionIsr) : null
  if (retentionIsr != null && (!Number.isFinite(retentionIsr) || retentionIsr < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'retentionIsr inválido' })
  }

  const paidAt = cleanText(body?.paidAt)
  if (!paidAt) throw createError({ statusCode: 400, statusMessage: 'La fecha de pago es obligatoria' })

  const db = useDb()

  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
  if (!store) throw createError({ statusCode: 404, statusMessage: 'Sucursal no existe' })

  // ─── Lo que se debe pagar es el subtotal puro (suma de conceptos).
  // IVA y retenciones son SOLO informativos: se calculan y se guardan,
  // pero no afectan `amount`, que es el monto real a cobrar. ───
  const subtotal = Math.round(items.reduce((sum, it) => sum + it.amount, 0) * 100) / 100
  const iva = Math.round(subtotal * IVA_RATE * 100) / 100

  const created = await db.transaction(async (tx) => {
    const [expense] = await tx
      .insert(expenses)
      .values({
        storeId,
        supplier,
        supplierInvoiceNumber,
        type,
        retentionIva: retentionIva != null ? String(retentionIva) : null,
        retentionIsr: retentionIsr != null ? String(retentionIsr) : null,
        amount: String(subtotal),
        paidAt,
        note: cleanText(body?.note),
        createdBy: profile.id
      })
      .returning()

    const insertedItems = await tx
      .insert(expenseItems)
      .values(items.map((it) => ({ expenseId: expense.id, reason: it.reason, amount: String(it.amount) })))
      .returning()

    return { ...expense, items: insertedItems, subtotal, iva }
  })

  return created
})