// ───────────────────────────────────────────────
//  TIPOS DEL DOMINIO DE INVENTARIO
// ───────────────────────────────────────────────
// Alineados al backend. IDs numéricos; los numeric llegan como string (usar Number()).

/** Roles de usuario (enum user_role). */
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
  maxQuantity: string | null
  isActive: boolean
  /** Existencia total sumando todas las tiendas (number, ya calculado). */
  totalStock: number
  /** Existencia por tienda */
  byStore: { storeId: number; quantity: number }[]
}

/** Detalle de un producto (`GET /api/products/:id`); incluye barcode, sin totalStock. */
export interface ApiProductDetail {
  id: number
  sku: string
  name: string
  categoryId: number | null
  color: string | null
  unit: ProductUnit
  price: string
  cost: string | null
  barcode: string | null
  minQuantity: string | null
  maxQuantity: string | null
  isActive: boolean
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
  /** Nº de empleados asignados (campo aditivo del endpoint). */
  employeeCount?: number
}

/** Cuerpo para crear una sucursal (`POST /api/stores`, admin). */
export interface NewStoreInput {
  name: string
  code: string
  address?: string | null
}

/** Cuerpo para editar una sucursal (`PATCH /api/stores/:id`, admin). El código no se edita. */
export interface StoreUpdateInput {
  name?: string
  address?: string | null
  isActive?: boolean
}

/** Categoría tal como la devuelve `GET /api/categories`. */
export interface ApiCategory {
  id: number
  name: string
  parentId: number | null
  /** Nombre del padre ya resuelto (null si es raíz). Campo aditivo. */
  parentName?: string | null
  /** Nº de productos que usan la categoría. Campo aditivo. */
  productCount?: number
}

/** Cuerpo para crear/editar una categoría (`POST`/`PATCH /api/categories`, admin). */
export interface CategoryInput {
  name: string
  parentId?: number | null
}

/** Perfil del usuario autenticado (`GET /api/me`); null si no hay sesión. */
export interface Me {
  id: string
  fullName: string
  role: UserRole
  storeId: number | null
}

/** Usuario/empleado tal como lo lista `GET /api/users` (admin). */
export interface ApiUser {
  id: string
  email: string | null
  fullName: string
  role: UserRole
  storeId: number | null
  storeCode: string | null
  storeName: string | null
  isActive: boolean
  createdAt: string
}

/** Cuerpo para crear un usuario (`POST /api/users`, admin). */
export interface NewUserInput {
  email: string
  password: string
  fullName: string
  role: UserRole
  storeId?: number | null
}

/** Cuerpo para editar un usuario (`PATCH /api/users/:id`, admin). El email no se edita. */
export interface UserUpdateInput {
  fullName?: string
  role?: UserRole
  storeId?: number | null
  isActive?: boolean
  password?: string
}

// ───────────────────────────────────────────────
//  CUERPOS DE PETICIÓN (POST/PATCH)
// ───────────────────────────────────────────────

/** Cuerpo para crear un producto (POST /api/products, solo admin). */
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
  maxQuantity?: number | null
  isActive?: boolean


  
}

/** Cuerpo para editar un producto (`PATCH /api/products/:id`, admin). SKU no editable. */
export type ProductUpdateInput = Partial<Omit<NewProductInput, 'sku'>>

/** Cuerpo para registrar una entrada de stock (`POST /api/movements/entrada`). */
export interface EntradaInput {
  productId: number
  storeId: number
  quantity: number
  reason?: string
  supplierInvoiceNumber?: string
  supplierInvoiceDate?: string
}

/** Método de pago de una venta (enum `payment_method`). */
export type PaymentMethod = 'efectivo' | 'tarjeta' | 'transferencia'

/** Etiquetas en español para cada método de pago. */
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia'
}

/** Cuerpo para registrar una venta (`POST /api/sales`). */
export interface SaleInput {
  storeId: number
  note?: string
  paymentMethod?: PaymentMethod
  items: { productId: number; quantity: number; unitPrice?: number }[]
}

// ───────────────────────────────────────────────
//  RESPUESTAS DE LECTURA (GET)
// ───────────────────────────────────────────────

/** Estado de una factura/venta (enum invoice_status). */
export type InvoiceStatus = 'emitida' | 'anulada'

/** Estado de un ticket de corrección (enum `ticket_status`). */
export type TicketStatus = 'abierto' | 'aprobado' | 'rechazado'

/** Ticket de corrección tal como lo lista `GET /api/tickets`. */
export interface ApiTicket {
  id: number
  target: 'factura' | 'movimiento'
  status: TicketStatus
  reason: string
  storeId: number
  storeCode: string | null
  invoiceId: number | null
  invoiceFolio: string | null
  invoiceStatus: InvoiceStatus | null
  invoiceTotal: string | null
  raisedByName: string | null
  resolvedByName: string | null
  resolutionNote: string | null
  createdAt: string
  resolvedAt: string | null
}

/** Cabecera de venta tal como la lista `GET /api/sales`. */
export interface ApiSale {
  id: number
  folio: string
  storeId: number
  storeCode: string | null
  storeName: string | null
  status: InvoiceStatus
  paymentMethod: PaymentMethod
  /** numeric → string. Usar Number() para operar. */
  totalAmount: string
  note: string | null
  itemCount: number
  createdByName: string | null
  issuedAt: string
  voidedAt: string | null
  voidReason: string | null
  /** true si hay un ticket de corrección ABIERTO para esta venta. */
  pendingCorrection?: boolean
}

/** Corte de caja (snapshot) tal como lo lista `GET /api/cortes`. Los numeric → string. */
export interface ApiCorte {
  id: number
  storeId: number
  storeCode: string | null
  storeName: string | null
  createdByName: string | null
  periodFrom: string | null
  periodTo: string
  salesCount: number
  totalEmitido: string
  totalEfectivo: string
  totalTarjeta: string
  totalTransferencia: string
  voidedCount: number
  totalVoided: string
  note: string | null
  createdAt: string
}

/** Detalle de un corte (`GET /api/cortes/:id`): el snapshot + sus ventas del periodo. */
export interface ApiCorteDetail extends ApiCorte {
  sales: {
    id: number
    folio: string
    status: InvoiceStatus
    paymentMethod: PaymentMethod
    totalAmount: string
    createdByName: string | null
    issuedAt: string
  }[]
}
