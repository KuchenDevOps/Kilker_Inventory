// ───────────────────────────────────────────────
//  PATCH /api/kits/:id — edición de kit de venta (admin / admin_tienda)
// ───────────────────────────────────────────────

import { and, eq, inArray, ne } from 'drizzle-orm'
import { useDb } from '../../db'
import { products, salesKits, salesKitItems } from '../../db/schema'

interface PatchKitItemBody {
  productId?: number | string
  quantity?: number | string
  unitPrice?: number | string | null
}

interface PatchKitBody {
  sku?: string
  name?: string
  isActive?: boolean
  items?: PatchKitItemBody[]
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

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

  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'id de kit inválido' })
  }

  const db = useDb()

  const existing = await db.query.salesKits.findFirst({
    where: eq(salesKits.id, id)
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Kit no encontrado' })
  }

  const body = await readBody<PatchKitBody>(event)

  // ─── Campos simples (solo se tocan si vienen en el body) ───
  const patch: Partial<typeof salesKits.$inferInsert> = {}

  if (body?.sku !== undefined) {
    const sku = cleanText(body.sku)
    if (!sku) {
      throw createError({ statusCode: 400, statusMessage: 'El SKU es obligatorio' })
    }
    if (sku !== existing.sku) {
      const dupe = await db.query.salesKits.findFirst({
        where: and(eq(salesKits.sku, sku), ne(salesKits.id, id))
      })
      if (dupe) {
        throw createError({
          statusCode: 409,
          statusMessage: `Ya existe un kit con el SKU ${sku}`
        })
      }
    }
    patch.sku = sku
  }

  if (body?.name !== undefined) {
    const name = cleanText(body.name)
    if (!name) {
      throw createError({ statusCode: 400, statusMessage: 'El nombre es obligatorio' })
    }
    patch.name = name
  }

  if (body?.isActive !== undefined) {
    patch.isActive = !!body.isActive
  }

  // ─── Líneas del kit (reemplazo completo, solo si vienen en el body) ───
  let items: { productId: number; quantity: string; unitPrice: string | null }[] | null = null

  if (body?.items !== undefined) {
    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'El kit necesita al menos un producto' })
    }

    items = rawItems.map((it) => {
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

    const productIds = [...new Set(items.map((it) => it.productId))]
    if (productIds.length !== items.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'No puedes repetir el mismo producto dos veces en el kit'
      })
    }

    const found = await db
      .select({
        id: products.id,
        sku: products.sku,
        sampleOfProductId: products.sampleOfProductId
      })
      .from(products)
      .where(inArray(products.id, productIds))

    if (found.length !== productIds.length) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Uno o más productos del kit no existen'
      })
    }

    // Un kit se arma con productos, no con muestras (ver POST /api/kits).
    for (const product of found) assertNotSample(product, 'incluirla en un kit')
  }

  if (Object.keys(patch).length === 0 && items === null) {
    throw createError({ statusCode: 400, statusMessage: 'Nada que actualizar' })
  }

  const updated = await db.transaction(async (tx) => {
    let kit = existing
    if (Object.keys(patch).length > 0) {
      const [row] = await tx
        .update(salesKits)
        .set(patch)
        .where(eq(salesKits.id, id))
        .returning()
      if (!row) {
        throw createError({ statusCode: 500, statusMessage: 'No se pudo actualizar el kit' })
      }
      kit = row
    }

    let resultItems = await tx.query.salesKitItems.findMany({
      where: eq(salesKitItems.kitId, id)
    })

    if (items !== null) {
      await tx.delete(salesKitItems).where(eq(salesKitItems.kitId, id))
      resultItems = await tx
        .insert(salesKitItems)
        .values(
          items.map((it) => ({
            kitId: id,
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice
          }))
        )
        .returning()
    }

    return { ...kit, items: resultItems }
  })

  return updated
})