// Tipos del dominio de inventario.
//
// Los identificadores de campo siguen el borrador de `docs/MODELO-DATOS.md`
// (en inglés, para mapear sin fricción al futuro `server/db/schema.ts` de Drizzle).
// Las etiquetas visibles en la UI van en español.
//
// ⚠️ SUPUESTOS (pendientes de confirmar con las specs — ver docs/CONTEXTO.md §5):
//   - Catálogo de "bases" de pintura.
//   - Unidades de medida.
//   - Que un "producto" es una variante vendible concreta (1 SKU).

/** Bases de pintura asumidas. Confirmar contra el catálogo real. */
export const PRODUCT_BASES = ['agua', 'aceite', 'latex', 'epoxica', 'otro'] as const
export type ProductBase = (typeof PRODUCT_BASES)[number]

/** Unidades de medida asumidas. */
export const PRODUCT_UNITS = ['L', 'gal', 'ml', 'kg', 'pieza'] as const
export type ProductUnit = (typeof PRODUCT_UNITS)[number]

/** Producto del catálogo (una variante vendible = un SKU). */
export interface Product {
  id: string
  sku: string
  name: string
  brand?: string
  category?: string
  color?: string
  colorCode?: string
  base?: ProductBase
  finish?: string
  volume?: number
  unit: ProductUnit
  barcode?: string
  price?: number
  cost?: number
  /** Mínimo de existencias para disparar alerta (por producto, simplificado). */
  minQuantity?: number
  isActive: boolean
  createdAt: string
}

/** Datos que captura el formulario de alta (sin campos autogenerados). */
export type NewProductInput = Omit<Product, 'id' | 'createdAt'>

/** Sucursal (location). */
export interface Location {
  id: string
  name: string
  code: string
  isActive: boolean
}

/** Existencias de un producto en una sucursal. */
export interface InventoryRow {
  productId: string
  locationId: string
  quantity: number
}
