// ───────────────────────────────────────────────
//  GET /api/products — catálogo (lectura pública)
// ───────────────────────────────────────────────
// Con categoría y stock total (suma de inventory en todas las tiendas).
//
// ⚠️ Las MUESTRAS quedan FUERA por omisión (`?samples=exclude`). Es a
// propósito: una muestra no tiene inventario propio ni se compra ni se
// transfiere, así que no pinta nada en el catálogo, en las exportaciones de
// valor de inventario ni en los pickers de entradas, kits y transferencias
// —que son todos consumidores de este endpoint—. Quien las necesita las pide:
// `?samples=include` (venta) o `?samples=only` (pantalla de administración).
// El default excluyente es el fail-safe: una pantalla nueva no hereda muestras
// sin querer.
import { count, isNotNull, isNull } from 'drizzle-orm'
import { useDb } from '../../db'
import { products } from '../../db/schema'

/** Cómo tratar las muestras en la respuesta. */
const SAMPLE_MODES = ['exclude', 'include', 'only'] as const
type SampleMode = (typeof SAMPLE_MODES)[number]

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const db = useDb()

  const requested = String(query.samples ?? 'exclude')
  const samples: SampleMode = SAMPLE_MODES.includes(requested as SampleMode)
    ? (requested as SampleMode)
    : 'exclude'

  const sampleFilter =
    samples === 'include'
      ? undefined
      : samples === 'only'
        ? isNotNull(products.sampleOfProductId)
        : isNull(products.sampleOfProductId)

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.products.findMany({
    where: sampleFilter,
    with: {
      category: { columns: { id: true, name: true } },
      inventory: { columns: { storeId: true, quantity: true } },
      // Producto base de la muestra: de ahí sale la existencia que se muestra
      // al vender (la muestra no tiene filas propias en `inventory`).
      sampleOf: {
        columns: { id: true, sku: true, name: true, isActive: true },
        with: { inventory: { columns: { storeId: true, quantity: true } } }
      }
    },
    orderBy: (p, { desc }) => [desc(p.createdAt)],
   ...(paginate
  ? { limit: pageSize, offset: (page - 1) * pageSize }
  : {})
  })

  const mapped = rows.map((p) => {
    // La existencia de una muestra ES la de su producto base: es el mismo
    // stock. Mostrar 0 aquí haría que el vendedor creyera que no hay nada.
    const stockRows = p.sampleOf ? p.sampleOf.inventory : p.inventory
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category?.name ?? null,
      categoryId: p.categoryId,
      color: p.color,
      unit: p.unit,
      price: p.price,
      cost: p.cost,
      minQuantity: p.minQuantity,
      maxQuantity: p.maxQuantity,
      isActive: p.isActive,
      // Muestras: null en un producto normal.
      sampleOfProductId: p.sampleOfProductId,
      baseSku: p.sampleOf?.sku ?? null,
      baseName: p.sampleOf?.name ?? null,
      baseIsActive: p.sampleOf?.isActive ?? null,
      totalStock: stockRows.reduce((sum, i) => sum + Number(i.quantity), 0),
      byStore: stockRows.map((i) => ({ storeId: i.storeId, quantity: Number(i.quantity) }))
    }
  })

  if (!paginate) return mapped

  // El total debe contar lo mismo que se lista, o la paginación miente.
  const totalCount =
    (
      await db
        .select({ value: count() })
        .from(products)
        .where(sampleFilter)
    )[0]?.value ?? 0

  return {
    data: mapped,
    total: totalCount,
    page,
    pageSize
  }
})
