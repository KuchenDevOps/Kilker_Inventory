// ───────────────────────────────────────────────
//  GET /api/kits — kits de venta con sus productos y precios
// ───────────────────────────────────────────────

import { and, count, eq, ilike, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { salesKits } from '../../db/schema'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const query = getQuery(event)
  const db = useDb()

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const filters = []

  const search = typeof query.q === 'string' ? query.q.trim() : ''
  if (search) {
    const like = `%${search}%`
    filters.push(or(ilike(salesKits.sku, like), ilike(salesKits.name, like)))
  }
  if (query.isActive === 'true') filters.push(eq(salesKits.isActive, true))
  else if (query.isActive === 'false') filters.push(eq(salesKits.isActive, false))

  const where = filters.length ? and(...filters) : undefined

  const rows = await db.query.salesKits.findMany({
    where,
    orderBy: (k, { desc }) => [desc(k.createdAt)],
    with: {
      items: {
        with: {
          product: {
            columns: {
              id: true,
              sku: true,
              name: true,
              unit: true,
              price: true,
              isActive: true
            }
          }
        }
      }
    },
    ...(paginate ? { limit: pageSize, offset: (page - 1) * pageSize } : {})
  })

  const mapped = rows.map((kit) => {
    const items = kit.items.map((it) => {
      const quantity = Number(it.quantity)
      // Precio de catálogo vigente del producto.
      const listUnitPrice = Number(it.product?.price ?? 0)
      // Precio pactado solo para este kit (null = hereda el de catálogo).
      const overrideUnitPrice = it.unitPrice == null ? null : Number(it.unitPrice)
      const unitPrice = overrideUnitPrice ?? listUnitPrice

      return {
        id: it.id,
        productId: it.productId,
        sku: it.product?.sku ?? null,
        name: it.product?.name ?? null,
        unit: it.product?.unit ?? null,
        productIsActive: it.product?.isActive ?? false,
        quantity,
        listUnitPrice,
        overrideUnitPrice,
        unitPrice,
        lineTotal: Math.round(unitPrice * quantity * 100) / 100,
        listLineTotal: Math.round(listUnitPrice * quantity * 100) / 100
      }
    })

    const totalPrice = items.reduce((sum, i) => sum + i.lineTotal, 0)
    const listTotalPrice = items.reduce((sum, i) => sum + i.listLineTotal, 0)

    return {
      id: kit.id,
      sku: kit.sku,
      name: kit.name,
      isActive: kit.isActive,
      createdAt: kit.createdAt,
      itemCount: items.length,
      items,
      /** Precio del kit aplicando los overrides de sus líneas. */
      totalPrice: Math.round(totalPrice * 100) / 100,
    
    }
  })

  if (!paginate) return mapped

  const [totalRow] = await db.select({ value: count() }).from(salesKits).where(where)

  return {
    data: mapped,
    total: totalRow?.value ?? 0,
    page,
    pageSize
  }
})
