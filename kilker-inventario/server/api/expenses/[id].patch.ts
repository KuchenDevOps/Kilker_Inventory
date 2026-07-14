// ───────────────────────────────────────────────
//  PATCH /api/expenses/:id — editar gasto
// ───────────────────────────────────────────────
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { expenses, stores } from '../../db/schema'

interface ExpenseUpdateBody {
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

  // Verificar que existe el gasto
  const existing = await db.query.expenses.findFirst({ 
    where: eq(expenses.id, id) 
  })
  
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Gasto no existe' })
  }

  // El empleado solo puede editar gastos de su propia tienda
  if (profile.role === 'empleado' && existing.storeId !== profile.storeId) {
    throw createError({ 
      statusCode: 403, 
      statusMessage: 'No puedes editar gastos de otra sucursal' 
    })
  }

  const values: Partial<typeof expenses.$inferInsert> = {}

  // Validar storeId - solo admin puede cambiar
  if (body.storeId !== undefined) {
    if (profile.role !== 'admin') {
      throw createError({ 
        statusCode: 403, 
        statusMessage: 'Solo un admin puede cambiar la sucursal' 
      })
    }

    const storeId = Number(body.storeId)
    if (!storeId || isNaN(storeId)) {
      throw createError({ statusCode: 400, statusMessage: 'storeId inválido' })
    }

    const store = await db.query.stores.findFirst({ 
      where: eq(stores.id, storeId) 
    })
    
    if (!store) {
      throw createError({ statusCode: 404, statusMessage: 'Sucursal no existe' })
    }
    
    values.storeId = storeId
  }

  // Validar supplier
  if (body.supplier !== undefined) {
    const supplier = cleanText(body.supplier)
    if (!supplier) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'El proveedor no puede quedar vacío' 
      })
    }
    values.supplier = supplier
  }

  // Validar supplierInvoiceNumber
  if (body.supplierInvoiceNumber !== undefined) {
    const num = cleanText(body.supplierInvoiceNumber)
    if (!num) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'El número de factura no puede quedar vacío' 
      })
    }
    values.supplierInvoiceNumber = num
  }

  // Validar reason
  if (body.reason !== undefined) {
    const reason = cleanText(body.reason)
    if (!reason) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'El motivo no puede quedar vacío' 
      })
    }
    values.reason = reason
  }
  if (body.retentionIva !== undefined) {
    const retentionIva = Number(body.retentionIva)
    if (!Number.isFinite(retentionIva) || retentionIva < 0) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'retentionIva inválido' 
      })
    }
    values.retentionIva = String(retentionIva)
  }
  if (body.retentionIsr !== undefined) {
    const retentionIsr = Number(body.retentionIsr)
    if (!Number.isFinite(retentionIsr) || retentionIsr < 0) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'retentionIsr inválido' 
      })
    }
    values.retentionIsr = String(retentionIsr)
  }

  // Validar amount
  if (body.amount !== undefined) {
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount < 0) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'Monto inválido' 
      })
    }
      values.amount = String(amount)
  }

  // Validar paidAt
  if (body.paidAt !== undefined) {
    const paidAt = cleanText(body.paidAt)
    if (!paidAt) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'La fecha de pago no puede quedar vacía' 
      })
    }
    values.paidAt = paidAt
  }

  // Validar note (puede ser null)
  if (body.note !== undefined) {
    values.note = cleanText(body.note)
  }

  // Si no hay nada para actualizar
  if (Object.keys(values).length === 0) {
    throw createError({ 
      statusCode: 400, 
      statusMessage: 'No hay datos para actualizar' 
    })
  }

  try {
    const [updated] = await db
      .update(expenses)
      .set(values)
      .where(eq(expenses.id, id))
      .returning()

    if (!updated) {
      throw createError({ 
        statusCode: 404, 
        statusMessage: 'No se pudo actualizar el gasto' 
      })
    }

    return updated
  } catch (error) {
    console.error('Error updating expense:', error)
    throw createError({ 
      statusCode: 500, 
      statusMessage: 'Error al actualizar el gasto' 
    })
  }
})