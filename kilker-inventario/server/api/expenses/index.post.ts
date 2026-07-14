// ───────────────────────────────────────────────
//  POST /api/expenses — registrar un gasto
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { expenses, stores } from '../../db/schema'

interface NewExpenseBody {
  storeId?: number
  supplier?: string
  supplierInvoiceNumber?: string
  reason?: string
  retentionIva?: number | string
  retentionIsr?: number | string
  amount?: number | string
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

  // El empleado registra en su tienda; el admin elige.
  const storeId = profile.role === 'admin' ? Number(body?.storeId) : Number(profile.storeId)
  if (!storeId) {
    throw createError({
      statusCode: 400,
      statusMessage:
        profile.role === 'admin'
          ? 'storeId es requerido'
          : 'Tu perfil debe tener una sucursal asignada'
    })
  }

  const supplier = cleanText(body?.supplier)
  const supplierInvoiceNumber = cleanText(body?.supplierInvoiceNumber)
  const reason = cleanText(body?.reason)

  if (!supplier) throw createError({ statusCode: 400, statusMessage: 'El proveedor es obligatorio' })
  if (!supplierInvoiceNumber) {
    throw createError({ statusCode: 400, statusMessage: 'El número de factura es obligatorio' })
  }
  if (!reason) throw createError({ statusCode: 400, statusMessage: 'El motivo es obligatorio' })

    const retentionIva = body?.retentionIva != null ? Number(body.retentionIva) : null
  if (retentionIva != null && (!Number.isFinite(retentionIva) || retentionIva < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'retentionIva inválido' })
  }
    const retentionIsr = body?.retentionIsr != null ? Number(body.retentionIsr) : null
    if (retentionIsr != null && (!Number.isFinite(retentionIsr) || retentionIsr < 0)) {
    throw createError({ statusCode: 400, statusMessage: 'retentionIsr inválido' })
  }

  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Monto inválido' })
  }

  const paidAt = cleanText(body?.paidAt)
  if (!paidAt) {
    throw createError({ statusCode: 400, statusMessage: 'La fecha de pago es obligatoria' })
  }

  const db = useDb()

  const store = await db.query.stores.findFirst({ where: eq(stores.id, storeId) })
  if (!store) throw createError({ statusCode: 404, statusMessage: 'Sucursal no existe' })

  const [created] = await db
    .insert(expenses)
    .values({
      storeId,
      supplier,
      supplierInvoiceNumber,
      reason,
        retentionIva: retentionIva != null ? String(retentionIva) : null,
        retentionIsr: retentionIsr != null ? String(retentionIsr) : null,
      amount: String(amount),
      paidAt,
      note: cleanText(body?.note),
      createdBy: profile.id
    })
    .returning()

  return created
})