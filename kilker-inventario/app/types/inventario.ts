// ───────────────────────────────────────────────
//  TIPOS DEL DOMINIO DE INVENTARIO
// ───────────────────────────────────────────────
// Alineados al backend. IDs numéricos; los numeric llegan como string (usar Number()).

/** Roles de usuario (enum user_role). */
/** `observador`: solo consulta. Ve todas las sucursales, no puede escribir. */
/**
 * `admin_tienda`: administrador de UNA sucursal (encargado de tienda), distinto
 * del `admin` de la empresa. Acotado a su sucursal como el empleado, pero
 * gestiona el catálogo compartido (productos, kits y categorías).
 */
export type UserRole = 'admin' | 'empleado' | 'observador' | 'admin_tienda'

/**
 * Roles acotados a su sucursal: no ven ni operan las demás. Espejo en la UI de
 * STORE_SCOPED_ROLE_LIST (`server/utils/auth.ts`) — se duplica a propósito
 * porque `server/` y `app/` no comparten módulos; si cambia uno, cambia el otro.
 */
export const STORE_SCOPED_ROLES: UserRole[] = ['empleado', 'admin_tienda']

/** Roles que dan de alta y editan el catálogo (productos, kits, categorías). */
export const CATALOG_MANAGER_ROLES: UserRole[] = ['admin', 'admin_tienda']

/** Etiquetas en español de cada rol (menú, badges y formularios). */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  admin_tienda: 'Administrador de tienda',
  empleado: 'Empleado',
  observador: 'Observador (solo consulta)'
}

/** Unidades de medida del catálogo (enum `product_unit`). */
export const PRODUCT_UNITS = ['litro', 'galon', 'cubeta', 'pieza', 'cuarto', 'tambo'] as const
export type ProductUnit = (typeof PRODUCT_UNITS)[number]

/** Etiquetas en español para cada unidad. */
export const UNIT_LABELS: Record<ProductUnit, string> = {
  litro: 'Litro',
  galon: 'Galón',
  cubeta: 'Cubeta',
  pieza: 'Pieza',
  cuarto: 'Cuarto',
  tambo: 'Tambo'
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
  /**
   * Producto base del que esta fila es MUESTRA; null en un producto normal.
   * Una muestra se entrega a precio 0 y **descuenta el inventario del base**
   * (no tiene existencias propias), así que `totalStock`/`byStore` de abajo ya
   * vienen resueltos con los del producto base.
   *
   * ⚠️ `GET /api/products` **no** devuelve muestras salvo que se pidan
   * (`?samples=include|only`): usa `useSellableProducts()` para vender.
   */
  sampleOfProductId: number | null
  /** SKU y nombre del producto base (solo en muestras). */
  baseSku: string | null
  baseName: string | null
  baseIsActive: boolean | null
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

/** Línea de un kit tal como la resuelve `GET /api/kits` (precios ya en number). */
export interface ApiKitItem {
  id: number
  productId: number
  sku: string | null
  name: string | null
  unit: ProductUnit | null
  productIsActive: boolean
  quantity: number
  listUnitPrice: number
  overrideUnitPrice: number | null
  unitPrice: number
  lineTotal: number
  listLineTotal: number
}

/** Kit de venta tal como lo lista `GET /api/kits`. */
export interface ApiKit {
  id: number
  sku: string
  name: string
  isActive: boolean
  createdAt: string
  itemCount: number
  items: ApiKitItem[]
  totalPrice: number

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

/**
 * Cuenta bancaria tal como la devuelve `GET /api/bank-accounts`.
 *
 * ⚠️ De la tarjeta sólo existen los últimos 4 dígitos, en toda la pila: el
 * número completo no se guarda ni se acepta. `cardLast4` es null cuando la
 * cuenta no tiene plástico.
 *
 * El EFECTIVO no es una cuenta: un pago en efectivo lleva `accountId: null`.
 */
export interface ApiBankAccount {
  id: number
  bank: string
  owner: string
  cardLast4: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  /** Pagos (de ventas, entradas y gastos) que usan esta cuenta. Campo aditivo. */
  paymentCount?: number
}

/** Cuerpo para crear una cuenta bancaria (`POST /api/bank-accounts`, admin). */
export interface NewBankAccountInput {
  bank: string
  owner: string
  /** Exactamente 4 dígitos, o null. Un número largo se rechaza con 400. */
  cardLast4?: string | null
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

/**
 * Cuerpo para dar de alta una MUESTRA (`POST /api/products`, admin o
 * admin_tienda). No lleva precio, costo ni unidad: el precio de una muestra es
 * siempre 0 y lo demás lo hereda del producto base. Si se omiten `sku`/`name`,
 * el servidor los deriva del base (`<SKU>-M` y `<nombre> (MUESTRA)`).
 */
export interface NewSampleInput {
  sampleOfProductId: number
  sku?: string
  name?: string
  isActive?: boolean
}

/** Cuerpo para registrar una entrada de stock (`POST /api/movements/entrada`). */
export interface EntradaInput {
  productId: number
  storeId: number
  quantity: number
  unitValue?: number
  reason?: string
  supplierInvoiceNumber?: string
  supplierInvoiceDate?: string
}

/** Método de pago de una venta (enum `payment_method`). */
export type PaymentMethod = 'efectivo' | 'debito' | 'credito' | 'transferencia'


export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  debito: 'Tarjeta de débito',
  credito: 'Tarjeta de crédito',
  transferencia: 'Transferencia'
}

/** Cuerpo para registrar una venta (`POST /api/sales`). */
export interface SaleInput {
  storeId: number
  customerId?: number | null
  channel?: SaleChannel
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

/**
 * Documento al que apunta el ticket (enum `ticket_target`):
 * `factura` = venta, `movimiento` = entrada de stock. Cada uno tiene su
 * pantalla: /tickets/ventas y /tickets/entradas.
 */
export type TicketTarget = 'factura' | 'movimiento'

/** Ticket de corrección tal como lo lista `GET /api/tickets`. */
export interface ApiTicket {
  id: number
  target: TicketTarget
  status: TicketStatus
  reason: string
  storeId: number
  storeCode: string | null
  // ─── target 'factura' ───
  invoiceId: number | null
  invoiceFolio: string | null
  invoiceStatus: InvoiceStatus | null
  invoiceTotal: string | null
  // ─── target 'movimiento': entrada de stock ───
  movementId: number | null
  movementFolio: string | null
  movementProductName: string | null
  movementProductSku: string | null
  movementUnit: ProductUnit | null
  movementQuantity: string | null
  movementTotal: string | null
  movementSupplierInvoice: string | null
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
   customerId: number | null
  customerName: string | null
  channel: SaleChannel
  status: InvoiceStatus
  paymentMethod: PaymentMethod
  /** numeric → string. Usar Number() para operar. */
  subtotalAmount: string
  discountPct: string
  discountAmount: string
  totalAmount: string  
  note: string | null
  itemCount: number
  createdByName: string | null
  issuedAt: string
  voidedAt: string | null
  voidReason: string | null
  /** true si hay un ticket de corrección ABIERTO para esta venta. */
  pendingCorrection?: boolean
  /** Importe cobrable (= totalAmount, ya con descuento y sin IVA). */
  totalToPay: number
  totalPaid: number
  balance: number
  /**
   * Derivado en el servidor, no vive en la BD. `anulada` gana sobre el resto, y
   * una venta de $0 (muestras, o 100% de descuento) sale directo como `pagado`.
   */
  paymentStatus: SalePaymentStatus
    items: ApiSaleItem[]

}

/** Mismo juego de estados que las entradas (`EntryPaymentStatus`). */
export type SalePaymentStatus = 'pendiente' | 'parcial' | 'pagado' | 'anulada'

export const SALE_PAYMENT_STATUS_LABELS: Record<SalePaymentStatus, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcial',
  pagado: 'Pagado',
  anulada: 'Anulada'
}

/** Abono de una venta (`GET /api/sales/:id/payments`). */
export interface ApiSalePayment {
  id: number
  invoiceId: number
  amount: string
  paidAt: string
  method: PaymentMethod
  /** Cuenta de la que salió/entró el dinero. null = efectivo (o histórico sin asignar). */
  accountId: number | null
  /** Banco + últimos 4 ya armados por el endpoint. null cuando no hay cuenta. */
  accountLabel: string | null
  note: string | null
  createdByName: string | null
  createdAt: string
}

/** Cuerpo para registrar un abono (`POST /api/sales/:id/payments`). */
export interface NewSalePaymentInput {
  amount: number
  paidAt: string
  method?: PaymentMethod
  note?: string
}

export interface ApiSaleItem {
  id: number
  productId: number
  productName: string | null
  productSku: string | null
  unit: ProductUnit | null
  quantity: string
  unitPrice: string
  lineTotal: string
  /** Kit del que salió esta línea; null si se vendió suelta. Snapshot al vender. */
  kitId: number | null
  kitSku: string | null
  kitName: string | null
  /** Cuántos kits se vendieron (igual en todas las líneas del mismo kit). */
  kitQuantity: string | null
  /**
   * Muestra entregada en esta línea; null si fue una venta normal. Snapshot al
   * vender. `productId`/`productSku` son SIEMPRE el producto base (el que
   * movió inventario): esto solo marca que salió como muestra, a precio 0.
   */
  sampleProductId: number | null
  sampleSku: string | null
  sampleName: string | null
}

export interface ApiSaleDetail
  extends Omit<ApiSale, 'totalToPay' | 'totalPaid' | 'balance' | 'paymentStatus'> {
  items: ApiSaleItem[]
}

/** Entrada de stock tal como la lista `GET /api/movements`. Los numeric → string. */
export interface ApiMovement {
  id: number
  productId: number
  productName: string | null
  productSku: string | null
  unit: ProductUnit | null
  storeId: number
  storeCode: string | null
  storeName: string | null
  quantity: string
  unitValue: string
  totalValue: string
  supplierInvoiceNumber: string | null
  supplierInvoiceDate: string | null
  folio: string | null
  createdByName: string | null
  createdAt: string
  voided: boolean
  /** Hay un ticket de corrección abierto contra esta entrada. */
  pendingCorrection: boolean
  /** Costo limpio de la entrada (= totalValue). Sin IVA ni retenciones. */
  totalToPay: number
  totalPaid: number
  balance: number
  /** Derivado en el servidor, no vive en la BD. `anulada` gana sobre el resto. */
  paymentStatus: EntryPaymentStatus
}

export type EntryPaymentStatus = 'pendiente' | 'parcial' | 'pagado' | 'anulada'

export const ENTRY_PAYMENT_STATUS_LABELS: Record<EntryPaymentStatus, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcial',
  pagado: 'Pagado',
  anulada: 'Anulada'
}

/** Abono de una entrada (`GET /api/movements/:id/payments`). */
export interface ApiEntryPayment {
  id: number
  movementId: number
  amount: string
  paidAt: string
  method: PaymentMethod
  /** Cuenta de la que salió/entró el dinero. null = efectivo (o histórico sin asignar). */
  accountId: number | null
  /** Banco + últimos 4 ya armados por el endpoint. null cuando no hay cuenta. */
  accountLabel: string | null
  note: string | null
  createdByName: string | null
  createdAt: string
}

/** Cuerpo para registrar un abono (`POST /api/movements/:id/payments`). */
export interface NewEntryPaymentInput {
  amount: number
  paidAt: string
  method?: PaymentMethod
  note?: string
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
  totalDebito: string
  totalCredito: string
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

export interface ApiAverageCost {
  productId: number
  storeId: number
  avgCost: number
  availableQty: number
  totalCost: number
}


export interface ApiMonthlyInventoryWindow {
  from: string
  to: string
  entriesValue: number
  exitsValue: number
  endingInventoryValue: number
  endingUnits: number
  // Ojo: el servidor devuelve `transfersOut*` (en plural). Antes el tipo decía
  // `transferOut*` y nunca cuadraba con el payload real.
  transfersOutValue: number
  transfersOutUnits: number
  transfersInValue: number
  transfersInUnits: number
  productsWithStock: number
  // Flujos del FIFO. Con estos cuadra, al peso:
  //   apertura + inflowsValue − soldCost − otherOutflowsCost = endingInventoryValue
  // No confundir `inflowsValue` con la tarjeta "Compras" ni `soldCost` con
  // "Costo total": esas dos dejan fuera transferencias, anulaciones y la carga
  // inicial, y por eso con ellas la cuenta no cierra.
  openingInventoryValue: number
  openingUnits: number
  inflowsValue: number
  soldCost: number
  otherOutflowsCost: number
  /** Unidades vendidas sin existencia registrada dentro del periodo. */
  uncoveredSaleUnits: number
  uncoveredSaleValue: number
}

export interface ApiMonthlyInventory extends ApiMonthlyInventoryWindow {
  month: string
  /**
   * Los mismos flujos acumulados desde la carga del inventario inicial
   * (1-ene-2026) hasta el MISMO corte, en vez de solo el periodo elegido. Es lo
   * que alimenta "Cómo se llegó al inventario final": el periodo responde "qué
   * pasó en agosto"; esto responde "cómo llegó el almacén a valer lo que vale".
   */
  reconciliation: ApiMonthlyInventoryWindow
}

export interface ApiTopProduct {
  productId: number
  productName: string | null
  productSku: string | null
  unit: ProductUnit
  totalQuantity: number
  totalRevenue: number
  totalCost: number
  profit: number
  profitPct: number
  hasSales: boolean
  /**
   * Unidades vendidas que salieron contra una capa de costo $0: su `totalCost`
   * es 0 y su utilidad da 100%, pero por una entrada capturada sin costo, no
   * porque el producto sea rentable.
   */
  zeroCostUnits: number
  zeroCostRevenue: number
}

export interface ApiUnsoldProduct {
  productId: number
  productName: string | null
  productSku: string | null
  unit: ProductUnit
  category: number | null
}

/** Canal de la venta (enum sale_channel). */
export type SaleChannel = 'mostrador' | 'en_linea'

export const CHANNEL_LABELS: Record<SaleChannel, string> = {
  mostrador: 'Mostrador',
  en_linea: 'En línea'
}

/** Cliente tal como lo devuelve `GET /api/customers`. */
export interface ApiCustomer {
  id: number
  name: string
  rfc: string | null
  address: string | null
  email: string | null
  phone: string | null
  isActive: boolean
}

/** Cuerpo para crear/editar un cliente. */
export interface CustomerInput {
  name: string
  rfc?: string | null
  address?: string | null
  email?: string | null
  phone?: string | null
}
export type ExpenseType = 'Fijo' | 'Operativo'

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  Fijo: 'Fijo',
  Operativo: 'Operativo'
}


export type PaymentStatus = 'pendiente' | 'parcial' | 'pagado'
/** @deprecated usa PaymentStatus */
export type ExpensePaymentStatus = PaymentStatus

/** Línea de concepto de un gasto. */
export interface ApiExpenseItem {
  id: number
  reason: string
  amount: string
}

/** Gasto operativo con su saldo calculado (`GET /api/expenses`). */
export interface ApiExpense {
  id: number
  storeId: number
  storeCode: string | null
  storeName: string | null
  supplier: string
  supplierInvoiceNumber: string
    type: ExpenseType          // ← nuevo
  items: ApiExpenseItem[]
  itemCount: number
  /** Suma de items.amount, sin IVA. */
  subtotal: number
  /** subtotal * 16%. */
  iva: number
  retentionIva: string | null
  retentionIsr: string | null
  /** Total final: subtotal + iva - retenciones. */
  amount: string
  /** Igual que amount, en number. */
  totalToPay: number
  /** Suma de todos los pagos registrados. */
  totalPaid: number
  /** totalToPay - totalPaid (nunca negativo). */
  balance: number
  paymentStatus: PaymentStatus
  /** Empresas/personas que pagaron (distintas), tomadas de expense_payments.paid_by. */
  payers: string[]
  paidAt: string
  note: string | null
  createdByName: string | null
  createdAt: string
}

export interface ApiExpensesPage {
  data: ApiExpense[]
  total: number
  page: number
  pageSize: number
}

/** Línea de concepto para alta/edición (`POST` / `PATCH`). */
export interface NewExpenseItemInput {
  reason: string
  amount: number
}

/** Cuerpo para registrar un gasto (`POST /api/expenses`). */
export interface NewExpenseInput {
  storeId: number
  supplier: string
  supplierInvoiceNumber: string
  type: ExpenseType         
  items: NewExpenseItemInput[]
  retentionIva?: number
  retentionIsr?: number
  paidAt: string
  note?: string | null
}

/** Pago/abono de un gasto (`GET /api/expenses/:id/payments`). */
export interface ApiExpensePayment {
  id: number
  expenseId: number
  amount: string
  paidAt: string
  paidBy: string
  method: PaymentMethod
  /** Cuenta de la que salió/entró el dinero. null = efectivo (o histórico sin asignar). */
  accountId: number | null
  /** Banco + últimos 4 ya armados por el endpoint. null cuando no hay cuenta. */
  accountLabel: string | null
  note: string | null
  createdByName: string | null
  createdAt: string
}

/** Cuerpo para registrar un pago (`POST /api/expenses/:id/payments`). */
export interface NewExpensePaymentInput {
  amount: number
  paidAt: string
  paidBy: string
  method?: PaymentMethod
  note?: string
}
export type TransferStatus = 'pendiente' | 'en_transito' | 'recibida' | 'cancelada'

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  pendiente: 'Pendiente',
  en_transito: 'En tránsito',
  recibida: 'Recibida',
  cancelada: 'Cancelada'
}

export interface ApiTransferItem {
  id: number
  productId: number
  productName: string | null
  productSku: string | null
  unit: ProductUnit | null
  quantity: string
  receivedByName: string | null
  canceledByName: string | null
  issuedAt: string
  /** Costo unitario tomado al momento de la salida (para valuar la transferencia). */
  unitValue: string
}

export interface ApiTransfer {
  id: number
  fromStoreId: number
  fromStoreCode: string | null
  fromStoreName: string | null
  toStoreId: number
  toStoreCode: string | null
  toStoreName: string | null
  status: TransferStatus
  note: string | null
  createdByName: string | null
  itemCount: number
  totalValue: number
  createdAt: string
  issuedAt: string
  receivedAt: string | null
  canceledAt: string | null
  cancelReason: string | null
}

export interface ApiTransferDetail extends ApiTransfer {
  items: ApiTransferItem[]
  receivedByName: string | null
  canceledByName: string | null
}

export interface NewTransferInput {
  fromStoreId: number
  toStoreId: number
  note?: string
  items: { productId: number; quantity: number }[]
}