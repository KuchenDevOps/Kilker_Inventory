// ───────────────────────────────────────────────
//  POST /api/products — alta de producto (admin)
// ───────────────────────────────────────────────
// Inserta en products; no crea inventario. Los numeric se guardan como string.
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { categories, products, productUnit } from '../../db/schema'

const UNITS = productUnit.enumValues

interface NewProductBody {
  sku?: string
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

/** Limpia un texto opcional: trim → undefined si queda vacío. */
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
  const body = await readBody<NewProductBody>(event)

  const sku = cleanText(body?.sku)
  const name = cleanText(body?.name)
  const unit = body?.unit

  if (!sku) {
    throw createError({ statusCode: 400, statusMessage: 'El SKU es obligatorio' })
  }
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
  }
  if (!unit || !UNITS.includes(unit as (typeof UNITS)[number])) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unidad inválida (use: ${UNITS.join(', ')})`
    })
  }
  const price = Number(body?.price)
  if (!Number.isFinite(price) || price < 0) {
    throw createError({ statusCode: 400, statusMessage: 'Precio inválido' })
  }
  const cost = optionalAmount(body?.cost, 'Costo')
  const minQuantity = optionalAmount(body?.minQuantity, 'Stock mínimo')
  const maxQuantity = optionalAmount(body?.maxQuantity, 'Stock maximo')

  const db = useDb()

  // SKU único: validamos antes para un 409 claro.
  const existing = await db.query.products.findFirst({
    where: eq(products.sku, sku)
  })
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: `Ya existe un producto con el SKU ${sku}`
    })
  }

  // Validar la categoría si viene.
  let categoryId: number | null = null
  if (body?.categoryId != null) {
    categoryId = Number(body.categoryId)
    const cat = await db.query.categories.findFirst({
      where: eq(categories.id, categoryId)
    })
    if (!cat) {
      throw createError({ statusCode: 400, statusMessage: 'La categoría no existe' })
    }
  }

  const [created] = await db
    .insert(products)
    .values({
      sku,
      name,
      categoryId,
      color: cleanText(body?.color),
      unit: unit as (typeof UNITS)[number],
      price: String(price),
      cost,
      barcode: cleanText(body?.barcode),
      minQuantity,
      maxQuantity,
      isActive: body?.isActive ?? true
    })
    .returning()

  return created
})
