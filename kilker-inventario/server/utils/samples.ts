// ───────────────────────────────────────────────
//  MUESTRAS DE PRODUCTO
// ───────────────────────────────────────────────
// Una MUESTRA es una "segunda versión" de un producto del catálogo: misma
// unidad, misma categoría, mismo color y —sobre todo— EL MISMO INVENTARIO.
// Solo cambian dos cosas: su precio de venta es siempre 0 y la línea de venta
// queda marcada como muestra, para poder distinguirla de una venta normal.
//
// ⚠️ REGLA CENTRAL, y el motivo de que este archivo exista:
// **una muestra NUNCA aparece en `inventory` ni en `stock_movements`.**
// Al venderla, el servidor la resuelve a su producto base y es ese id el que
// entra al kardex, al saldo y a `invoice_items.product_id` — exactamente como
// un kit se "explota" en sus productos al venderse. Si la muestra moviera
// stock con su propio id, tendría capas FIFO propias sin una sola entrada que
// las cubriera: cada muestra entregada nacería como venta descubierta y el
// inventario del producto real nunca bajaría.
//
// Por eso el corte es `stockProductId(product)` y no `product.id` a secas: el
// literal `product.id` repartido por los endpoints es justo la forma de que a
// alguien se le olvide resolver la muestra en el endpoint número treinta (ver
// la nota de `isStoreScopedRole` en auth.ts — mismo problema, misma solución).

/** Sufijo con el que se nombran las muestras por omisión. */
export const SAMPLE_NAME_SUFFIX = '(MUESTRA)'

/** Sufijo con el que se genera el SKU de una muestra por omisión. */
export const SAMPLE_SKU_SUFFIX = '-M'

/** Lo mínimo que hay que saber de un producto para resolver su inventario. */
export interface SampleAwareProduct {
  id: number
  sampleOfProductId: number | null
}

/** true si el producto es una muestra de otro. */
export function isSampleProduct(product: SampleAwareProduct): boolean {
  return product.sampleOfProductId != null
}

/**
 * Producto cuyo inventario se mueve realmente: el base si es una muestra, o el
 * propio producto si es normal. **Todo endpoint que toque `inventory` o
 * `stock_movements` debe pasar por aquí.**
 */
export function stockProductId(product: SampleAwareProduct): number {
  return product.sampleOfProductId ?? product.id
}

/**
 * Rechaza una muestra en flujos donde no tiene sentido (entradas, kits,
 * transferencias): no se compra, no se transfiere ni se arma un kit con algo
 * que no tiene existencias propias — eso se hace sobre el producto base.
 */
export function assertNotSample(
  product: SampleAwareProduct & { sku: string },
  action: string
): void {
  if (!isSampleProduct(product)) return
  throw createError({
    statusCode: 400,
    statusMessage: `${product.sku} es una muestra: no se puede ${action}. Usa el producto base — la muestra comparte su inventario.`
  })
}

/** SKU sugerido para la muestra de un producto: `<SKU base>-M`. */
export function defaultSampleSku(baseSku: string): string {
  return `${baseSku}${SAMPLE_SKU_SUFFIX}`
}

/** Nombre sugerido para la muestra de un producto: `<nombre base> (MUESTRA)`. */
export function defaultSampleName(baseName: string): string {
  return `${baseName} ${SAMPLE_NAME_SUFFIX}`
}
