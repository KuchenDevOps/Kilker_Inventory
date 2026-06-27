// ───────────────────────────────────────────────
//  PATCH /api/products/:id — editar producto (admin)
// ───────────────────────────────────────────────
// Actualiza datos comerciales (precio/costo estándar, etc.). El SKU no se edita.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { categories, products, productUnit } from '../../db/schema'

const UNITS = productUnit.enumValues

interface PatchProductBody {
  name?: string
  categoryId?: number | null
  color?: string | null
  unit?: string
  price?: number | string
  cost?: number | string | null
  barcode?: string | null
  minQuantity?: number | string | null
  maxQuantity?: number | string | null
  isActive?: boolean
}

/** Limpia un texto opcional: trim → null si queda vacío. */
function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/** Convierte a número o null; lanza 400 si es inválido o negativo. */
function optionalAmount(v: unknown, field: string): string | null {
  if (v == null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) {
    throw createError({ statusCode: 400, statusMessage: `${field} inválido` })
  }
  return String(n)
}

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const body = await readBody<PatchProductBody>(event)
  const db = useDb()

  const current = await db.query.products.findFirst({ where: eq(products.id, id) })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'Producto no existe' })

  const patch: Record<string, unknown> = {}

  if (body?.name !== undefined) {
    const name = cleanText(body.name)
    if (!name) throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
    patch.name = name
  }

  if (body?.unit !== undefined) {
    if (!UNITS.includes(body.unit as (typeof UNITS)[number])) {
      throw createError({
        statusCode: 400,
        statusMessage: `Unidad inválida (use: ${UNITS.join(', ')})`
      })
    }
    patch.unit = body.unit
  }

  if (body?.price !== undefined) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0) {
      throw createError({ statusCode: 400, statusMessage: 'Precio inválido' })
    }
    patch.price = String(price)
  }

  if (body?.cost !== undefined) patch.cost = optionalAmount(body.cost, 'Costo')
  if (body?.minQuantity !== undefined) {
    patch.minQuantity = optionalAmount(body.minQuantity, 'Stock mínimo')
  }
  if (body?.maxQuantity !== undefined) {
    patch.maxQuantity = optionalAmount(body.maxQuantity, 'Stock máximo')
  }
  if (body?.color !== undefined) patch.color = cleanText(body.color)
  if (body?.barcode !== undefined) patch.barcode = cleanText(body.barcode)
  if (body?.isActive !== undefined) patch.isActive = !!body.isActive

  // Categoría: valida que exista si se manda un id.
  if (body?.categoryId !== undefined) {
    if (body.categoryId == null) {
      patch.categoryId = null
    } else {
      const categoryId = Number(body.categoryId)
      const cat = await db.query.categories.findFirst({ where: eq(categories.id, categoryId) })
      if (!cat) throw createError({ statusCode: 400, statusMessage: 'La categoría no existe' })
      patch.categoryId = categoryId
    }
  }

  if (Object.keys(patch).length === 0) return current

  const [updated] = await db
    .update(products)
    .set(patch)
    .where(eq(products.id, id))
    .returning()
  return updated
})
