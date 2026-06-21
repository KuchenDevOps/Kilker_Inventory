// Tipos del dominio de inventario — alineados al BACKEND REAL (server/api + Drizzle).
//
// Reemplazan a los tipos del mock anterior. Notas importantes del shape real:
//   - Los IDs de negocio son numéricos (`bigint` en Postgres → `number`).
//   - `unit` es el enum v1 `product_unit`: 'litro' | 'galon' | 'cubeta'.
//   - Los campos `numeric` de Postgres (price, cost, minQuantity, quantity…) llegan
//     como STRING por la API. Hay que `Number(...)` antes de operar/formatear.
//   - El catálogo v1 NO tiene base/acabado/volumen/marca (ver plan v1).
// Las etiquetas visibles en la UI van en español.

/** Roles de usuario (enum `user_role`). */
export type UserRole = 'admin' | 'empleado'

/** Unidades de medida del catálogo (enum `product_unit`). */
export const PRODUCT_UNITS = ['litro', 'galon', 'cubeta'] as const
export type ProductUnit = (typeof PRODUCT_UNITS)[number]

/** Etiquetas en español para cada unidad. */
export const UNIT_LABELS: Record<ProductUnit, string> = {
  litro: 'Litro',
  galon: 'Galón',
  cubeta: 'Cubeta'
}

/** Producto tal como lo devuelve `GET /api/products`. */
export interface ApiProduct {
  id: number
  sku: string
  name: string
  /** Nombre de la categoría (ya resuelto por el endpoint) o null. */
  category: string | null
  categoryId: number | null
  color: string | null
  unit: ProductUnit
  /** numeric → string. Usar Number() para operar. */
  price: string
  cost: string | null
  minQuantity: string | null
  isActive: boolean
  /** Existencia total sumando todas las tiendas (number, ya calculado). */
  totalStock: number
}

/** Tienda/sucursal tal como la devuelve `GET /api/stores`. */
export interface ApiStore {
  id: number
  name: string
  code: string
  address: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** Categoría tal como la devuelve `GET /api/categories`. */
export interface ApiCategory {
  id: number
  name: string
  parentId: number | null
}

/** Perfil del usuario autenticado (`GET /api/me`); null si no hay sesión. */
export interface Me {
  id: string
  fullName: string
  role: UserRole
  storeId: number | null
}

/** Cuerpo para crear un producto (`POST /api/products`, solo admin). */
export interface NewProductInput {
  sku: string
  name: string
  categoryId?: number | null
  color?: string | null
  unit: ProductUnit
  price: number
  cost?: number | null
  barcode?: string | null
  minQuantity?: number | null
  isActive?: boolean
}

/** Cuerpo para registrar una entrada de stock (`POST /api/movements/entrada`). */
export interface EntradaInput {
  productId: number
  storeId: number
  quantity: number
  unitValue?: number
  reason?: string
}

/** Cuerpo para registrar una venta (`POST /api/sales`). */
export interface SaleInput {
  storeId: number
  note?: string
  items: { productId: number; quantity: number; unitPrice?: number }[]
}
