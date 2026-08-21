// ───────────────────────────────────────────────
//  POST /api/products — alta de producto o de MUESTRA (admin / admin_tienda)
// ───────────────────────────────────────────────
// Inserta en products; no crea inventario. Los numeric se guardan como string.
//
// Con `sampleOfProductId` da de alta una MUESTRA del producto indicado: hereda
// unidad, categoría y color del base, su precio queda fijo en 0 y no lleva
// costo ni stock mínimo/máximo propios, porque no tiene inventario propio —
// comparte el del base (ver server/utils/samples.ts).
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { categories, products, productUnit } from '../../db/schema'
import { defaultSampleName, defaultSampleSku, isSampleProduct } from '../../utils/samples'

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
  /** Si viene, el alta es de una MUESTRA de ese producto base. */
  sampleOfProductId?: number | null
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
  await requireProfile(event, { role: CATALOG_MANAGER_ROLES })
  const body = await readBody<NewProductBody>(event)

  const db = useDb()

  const sampleOfProductId =
    body?.sampleOfProductId != null ? Number(body.sampleOfProductId) : null

  // ─── Alta de MUESTRA ───
  // Todo lo que define a la muestra sale del producto base; del cuerpo solo se
  // aceptan SKU, nombre y estado. Así una muestra no puede divergir del
  // producto cuyo inventario descuenta.
  if (sampleOfProductId != null) {
    if (!Number.isInteger(sampleOfProductId) || sampleOfProductId <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'sampleOfProductId inválido' })
    }

    const base = await db.query.products.findFirst({
      where: eq(products.id, sampleOfProductId)
    })
    if (!base) {
      throw createError({ statusCode: 400, statusMessage: 'El producto base no existe' })
    }
    // Sin cadenas de muestras: la muestra de una muestra no tendría de dónde
    // descontar (el check `products_sample_not_self` solo cubre el caso trivial).
    if (isSampleProduct(base)) {
      throw createError({
        statusCode: 400,
        statusMessage: `${base.sku} ya es una muestra: no se puede crear una muestra de una muestra`
      })
    }

    const already = await db.query.products.findFirst({
      where: eq(products.sampleOfProductId, sampleOfProductId)
    })
    if (already) {
      throw createError({
        statusCode: 409,
        statusMessage: `${base.sku} ya tiene una muestra (${already.sku}). Un producto solo puede tener una.`
      })
    }

    const sku = cleanText(body?.sku) ?? defaultSampleSku(base.sku)
    const name = cleanText(body?.name) ?? defaultSampleName(base.name)

    const skuTaken = await db.query.products.findFirst({ where: eq(products.sku, sku) })
    if (skuTaken) {
      throw createError({
        statusCode: 409,
        statusMessage: `Ya existe un producto con el SKU ${sku}`
      })
    }

    const [createdSample] = await db
      .insert(products)
      .values({
        sku,
        name,
        // Heredados del base: la muestra es el mismo producto, no otro.
        categoryId: base.categoryId,
        color: base.color,
        unit: base.unit,
        // Invariantes de una muestra: precio 0 y sin datos de stock propios,
        // porque no tiene inventario propio.
        price: '0',
        cost: null,
        barcode: null,
        minQuantity: null,
        maxQuantity: null,
        isActive: body?.isActive ?? true,
        sampleOfProductId
      })
      .returning()

    return createdSample
  }

  // ─── Alta de producto normal ───
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
