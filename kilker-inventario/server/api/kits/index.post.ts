// ───────────────────────────────────────────────
//  POST /api/kits — alta de kit de venta (admin)
// ───────────────────────────────────────────────
// Cabecera en sales_kits + líneas en sales_kit_items, en una transacción.
// unitPrice null = la línea usa el precio normal de products.price.
import { eq, inArray } from 'drizzle-orm'
import { useDb } from '../../db'
import { products, salesKits, salesKitItems } from '../../db/schema'

interface NewKitItemBody {
  productId?: number | string
  quantity?: number | string
  unitPrice?: number | string | null
}

interface NewKitBody {
  sku?: string
  name?: string
  isActive?: boolean
  items?: NewKitItemBody[]
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
  const body = await readBody<NewKitBody>(event)

  const sku = cleanText(body?.sku)
  const name = cleanText(body?.name)

  if (!sku) {
    throw createError({ statusCode: 400, statusMessage: 'El SKU es obligatorio' })
  }
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
  }

  // ─── Líneas del kit ───
  const rawItems = Array.isArray(body?.items) ? body.items : []
  if (rawItems.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'El kit necesita al menos un producto' })
  }

  const items = rawItems.map((it) => {
    const productId = Number(it?.productId)
    if (!Number.isInteger(productId) || productId <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'productId inválido en una de las líneas' })
    }
    const quantity = Number(it?.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'La cantidad de cada producto debe ser mayor a 0'
      })
    }
    return {
      productId,
      quantity: String(quantity),
      unitPrice: optionalAmount(it?.unitPrice, 'Precio unitario')
    }
  })

  // sales_kit_items tiene unique (kit_id, product_id): validamos antes para un 400 claro.
  const productIds = [...new Set(items.map((it) => it.productId))]
  if (productIds.length !== items.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No puedes repetir el mismo producto dos veces en el kit'
    })
  }

  const db = useDb()

  // SKU único: validamos antes para un 409 claro.
  const existing = await db.query.salesKits.findFirst({
    where: eq(salesKits.sku, sku)
  })
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: `Ya existe un kit con el SKU ${sku}`
    })
  }

  // Todos los productos referenciados deben existir.
  const found = await db
    .select({ id: products.id })
    .from(products)
    .where(inArray(products.id, productIds))

  if (found.length !== productIds.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Uno o más productos del kit no existen'
    })
  }

  const created = await db.transaction(async (tx) => {
    const [kit] = await tx
      .insert(salesKits)
      .values({
        sku,
        name,
        isActive: body?.isActive ?? true
      })
      .returning()
    if (!kit) {
      throw createError({ statusCode: 500, statusMessage: 'No se pudo crear el kit' })
    }

    const insertedItems = await tx
      .insert(salesKitItems)
      .values(
        items.map((it) => ({
          kitId: kit.id,
          productId: it.productId,
          quantity: it.quantity,
          unitPrice: it.unitPrice
        }))
      )
      .returning()

    return { ...kit, items: insertedItems }
  })

  return created
})
