// ───────────────────────────────────────────────
//  ESQUEMA DRIZZLE — INVENTARIO KILKER (v1)
// ───────────────────────────────────────────────
// Fuente de verdad del esquema Postgres. Solo se edita aquí + drizzle-kit.
// stock_movements: kardex append-only con signo. inventory: saldo materializado.

import { relations, sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn
} from 'drizzle-orm/pg-core'

// auth.users la gestiona Supabase; no se modela aquí. FK a profiles vía migración SQL.

// ───────────────────────────────────────────────
//  HELPERS
// ───────────────────────────────────────────────
/** created_at + updated_at con zona horaria. */
const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
})

// ───────────────────────────────────────────────
//  ENUMS
// ───────────────────────────────────────────────
// `observador`: solo consulta. Ve todas las sucursales (como admin) pero no
// puede escribir nada; el candado está en requireProfile (server/utils/auth.ts).
//
// `admin_tienda`: administrador de UNA sucursal (el encargado de la tienda), a
// diferencia de `admin`, que es la administración de la empresa. Opera acotado
// a su sucursal igual que un empleado —ver STORE_SCOPED_ROLES en
// server/utils/auth.ts— pero además gestiona el catálogo compartido
// (productos, kits y categorías: alta y edición, no borrado).
export const userRole = pgEnum('user_role', [
  'admin',
  'empleado',
  'observador',
  'admin_tienda'
])

export const movementType = pgEnum('movement_type', [
  'venta',
  'entrada',
  'ajuste',
  'transferencia_salida',
  'transferencia_entrada',
  'anulacion'
])

export const invoiceStatus = pgEnum('invoice_status', ['emitida', 'anulada'])

export const transferStatus = pgEnum('transfer_status', [
  'pendiente',
  'en_transito',
  'recibida',
  'cancelada'
])

export const ticketStatus = pgEnum('ticket_status', [
  'abierto',
  'aprobado',
  'rechazado'
])

export const ticketTarget = pgEnum('ticket_target', ['factura', 'movimiento', 'gasto'])

export const productUnit = pgEnum('product_unit', ['litro', 'galon', 'cubeta', 'pieza', 'cuarto', 'tambo'])


export const paymentMethod = pgEnum('payment_method', ['efectivo', 'debito', 'credito', 'transferencia'])

export const discountType = pgEnum('discount_type', ['porcentaje', 'combo'])

// ───────────────────────────────────────────────
//  TABLAS
// ───────────────────────────────────────────────

/** Tiendas / sucursales. Cada una controla su propio stock. */
export const stores = pgTable('stores', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  code: text('code').notNull().unique(),
  address: text('address'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps()
}).enableRLS()

/** Perfil de aplicación (1:1 con auth.users) + rol y tienda del empleado. */
export const profiles = pgTable('profiles', {
  // FK a auth.users ON DELETE CASCADE: se añade vía migración SQL manual.
  id: uuid('id').primaryKey(),
  fullName: text('full_name').notNull(),
  role: userRole('role').notNull(),
  // Tienda del empleado; admin puede ser null (acceso global).
  storeId: bigint('store_id', { mode: 'number' }).references(() => stores.id, {
    onDelete: 'set null'
  }),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps()
}).enableRLS()

/** Categorías / líneas de producto (jerarquía opcional). */
export const categories = pgTable('categories', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  name: text('name').notNull(),
  parentId: bigint('parent_id', { mode: 'number' }).references(
    (): AnyPgColumn => categories.id
  ),
  ...timestamps()
}).enableRLS()

/** Catálogo. En v1 solo `color` (texto libre) y `unit` (litro/galon/cubeta/pieza,cuarto/tambo). */
export const products = pgTable('products', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  maxQuantity: numeric('max_quantity', {precision: 14, scale: 3}),
  categoryId: bigint('category_id', { mode: 'number' }).references(
    () => categories.id
  ),
  color: text('color'),
  unit: productUnit('unit').notNull(),
  price: numeric('price', { precision: 14, scale: 2 }).notNull(),
  cost: numeric('cost', { precision: 14, scale: 2 }),
  barcode: text('barcode'),
  minQuantity: numeric('min_quantity', { precision: 14, scale: 3 }),
  isActive: boolean('is_active').notNull().default(true),
  sampleOfProductId: bigint('sample_of_product_id', { mode: 'number' }).references(
    (): AnyPgColumn => products.id
  ),
  ...timestamps()
}, (t) => [
  // Una sola muestra por producto base (los NULL no chocan entre sí en Postgres).
  unique('products_sample_of_uniq').on(t.sampleOfProductId),
  // El precio 0 de la muestra es invariante, no una convención de la app.
  check('products_sample_price_zero', sql`${t.sampleOfProductId} IS NULL OR ${t.price} = 0`),
  // Una muestra no puede ser muestra de sí misma (las cadenas se cortan en la API).
  check('products_sample_not_self', sql`${t.sampleOfProductId} IS NULL OR ${t.sampleOfProductId} <> ${t.id}`)
]).enableRLS()

export const salesKits = pgTable('sales_kits', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps()
}).enableRLS()

export const salesKitItems = pgTable('sales_kit_items', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  kitId: bigint('kit_id', { mode: 'number' })
    .notNull()
    .references(() => salesKits.id, { onDelete: 'cascade' }),
  productId: bigint('product_id', { mode: 'number' })
    .notNull()
    .references(() => products.id),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }),
  ...timestamps()
}, (table) => [
  unique('sales_kit_items_kit_product_unique').on(table.kitId, table.productId),
  index('sales_kit_items_kit_id_idx').on(table.kitId),
  index('sales_kit_items_product_id_idx').on(table.productId)
]).enableRLS()


/**
 * Cuentas bancarias de la empresa. Cada pago (de venta, de entrada o de gasto)
 * dice de qué cuenta salió o entró el dinero, y de ahí sale el saldo POR CUENTA
 * en `banks_movements`.
 *
 * ⚠️ El efectivo NO está aquí: un pago en efectivo lleva `account_id` en NULL y
 * se reporta como bolsa aparte (decisión del cliente). Consecuencia a tener
 * presente: "sin cuenta" y "efectivo" son el mismo estado en la base, así que
 * un pago bancario capturado sin elegir cuenta caería en la bolsa de efectivo
 * sin avisar. Por eso los endpoints de pago exigen cuenta cuando el método no
 * es efectivo (y la rechazan cuando sí lo es).
 *
 * ⚠️ De la tarjeta se guardan SOLO los últimos 4 dígitos. Alcanzan para que el
 * empleado identifique la cuenta al capturar un pago, y evitan que esta tabla
 * —que no está cifrada ni tokenizada— se vuelva un objetivo. No agregar aquí
 * el número completo, CVV, NIP ni credenciales de banca en línea.
 */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    /** Institución: BBVA, Santander, Banorte… */
    bank: text('bank').notNull(),
    /** A nombre de quién está la cuenta. */
    owner: text('owner').notNull(),
    /** Últimos 4 dígitos de la tarjeta. NULL si la cuenta no tiene plástico. */
    cardLast4: text('card_last4'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps()
  },
  (t) => [
    // Blindaje contra que alguien capture el número completo "de pasada": si no
    // son exactamente 4 dígitos, la base lo rechaza.
    check(
      'bank_accounts_card_last4_format',
      sql`${t.cardLast4} IS NULL OR ${t.cardLast4} ~ '^[0-9]{4}$'`
    ),
    unique('bank_accounts_identity_uniq').on(t.bank, t.owner, t.cardLast4)
  ]
).enableRLS()

/** Saldo materializado de existencias por (producto × tienda). */
export const inventory = pgTable(
  'inventory',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => products.id),
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id),
    quantity: numeric('quantity', { precision: 14, scale: 3 })
      .notNull()
      .default('0'),
    minQuantity: numeric('min_quantity', { precision: 14, scale: 3 }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date())
  },
  (t) => [
    unique('inventory_product_store_uniq').on(t.productId, t.storeId),
    check('inventory_quantity_non_negative', sql`${t.quantity} >= 0`)
  ]
).enableRLS()

export const saleChannel = pgEnum('sale_channel', ['mostrador', 'en_linea'])


/** Cabecera de venta (comprobante interno; sin CFDI/SAT en v1). */
export const invoices = pgTable(
  'invoices',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    // Folio secuencial por tienda (secuencia en migración SQL).
    folio: text('folio').notNull(),
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id),
     customerId: bigint('customer_id', { mode: 'number' }).references(() => customers.id, {
      onDelete: 'set null'
    }),
    
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    status: invoiceStatus('status').notNull().default('emitida'),
    
    // Método de pago (el corte de caja lleva una columna por cada valor).
    paymentMethod: paymentMethod('payment_method').notNull().default('efectivo'),
    
    channel: saleChannel('channel').notNull().default('mostrador'),

    note: text('note'),
    discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => profiles.id),
    voidReason: text('void_reason')
  },
  (t) => [unique('invoices_store_folio_uniq').on(t.storeId, t.folio)]
).enableRLS()


export const salePayments = pgTable(
  'sale_payments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    paidAt: date('paid_at').notNull(),
    method: paymentMethod('method').notNull().default('efectivo'),
    /** Cuenta a la que entró el dinero. NULL = efectivo (ver `bank_accounts`). */
    accountId: bigint('account_id', { mode: 'number' }).references(() => bankAccounts.id),
    note: text('note'),
    createdBy: uuid('created_by').notNull().references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('sale_payments_invoice_idx').on(t.invoiceId, t.paidAt)]
).enableRLS()

/** Líneas de venta. `unit_price` es snapshot al momento de la venta. */

export const invoiceItems = pgTable('invoice_items', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  invoiceId: bigint('invoice_id', { mode: 'number' })
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  productId: bigint('product_id', { mode: 'number' })
    .notNull()
    .references(() => products.id),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
  lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),
  discountType: discountType('discount_type'),
  discountValue: numeric('discount_value', { precision: 14, scale: 2 }),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }),
  // ─── Venta por kit ───
  // Un kit NO tiene inventario propio: al vender se "explota" en líneas de
  // producto normales (el kardex y el stock son siempre por producto). Estas
  // columnas solo marcan de qué kit vino cada línea, para reagruparlas en el
  // ticket. sku/name son snapshot al momento de la venta, igual que unit_price:
  // renombrar un kit después no debe cambiar tickets ya emitidos.
  kitId: bigint('kit_id', { mode: 'number' }).references(() => salesKits.id),
  kitSku: text('kit_sku'),
  kitName: text('kit_name'),
  /** Cuántos kits se vendieron (se repite en todas las líneas del mismo kit). */
  kitQuantity: numeric('kit_quantity', { precision: 14, scale: 3 }),
  // ─── Entrega como MUESTRA ───
  // La muestra tampoco tiene inventario propio: `product_id` guarda SIEMPRE el
  // producto BASE (el kardex, el FIFO y todos los reportes se apoyan en él) y
  // estas columnas solo marcan que la línea se entregó como muestra. sku/name
  // son snapshot al momento de la venta, igual que en los kits: renombrar la
  // muestra después no debe cambiar tickets ya emitidos.
  sampleProductId: bigint('sample_product_id', { mode: 'number' }).references(
    () => products.id
  ),
  sampleSku: text('sample_sku'),
  sampleName: text('sample_name')
}, (table) => [
  index('idx_invoice_items_product_id').on(table.productId),
  // este también te conviene: tu exists correlaciona por invoiceId
  index('idx_invoice_items_invoice_id').on(table.invoiceId),
  index('idx_invoice_items_kit_id').on(table.kitId),
  index('idx_invoice_items_sample_product_id').on(table.sampleProductId),
]).enableRLS()

/** Libro APPEND-ONLY (kardex). Fuente de verdad; cantidad e importe con signo. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    productId: bigint('product_id', { mode: 'number' })
      .notNull()
      .references(() => products.id),
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id),
    type: movementType('type').notNull(),
    // Signo: + entra, − sale.
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitValue: numeric('unit_value', { precision: 14, scale: 2 }).notNull(),
    totalValue: numeric('total_value', { precision: 14, scale: 2 }).notNull(),
    invoiceId: bigint('invoice_id', { mode: 'number' }).references(
      () => invoices.id
    ),
    transferId: bigint('transfer_id', { mode: 'number' }).references(
      () => transfers.id
    ),
    // Liga la reversa (anulacion) al movimiento original.
    reversesMovementId: bigint('reverses_movement_id', {
      mode: 'number'
    }).references((): AnyPgColumn => stockMovements.id),
    reason: text('reason'),
    supplierInvoiceNumber: text('supplier_invoice_number'),
    supplierInvoiceDate: date('supplier_invoice_date'),
    inventoryEntryInvoiceNumber: text('Folio'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('stock_movements_store_created_idx').on(t.storeId, t.createdAt),
    index('stock_movements_product_idx').on(t.productId),
    unique('stock_movements_store_folio_unique').on(t.storeId, t.inventoryEntryInvoiceNumber)
  ]
).enableRLS()

export const entryPayments = pgTable(
  'entry_payments',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    movementId: bigint('movement_id', { mode: 'number' })
      .notNull()
      .references(() => stockMovements.id),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    paidAt: date('paid_at').notNull(),
    method: paymentMethod('method').notNull().default('efectivo'),
    /** Cuenta de la que salió el dinero. NULL = efectivo (ver `bank_accounts`). */
    accountId: bigint('account_id', { mode: 'number' }).references(() => bankAccounts.id),
    note: text('note'),
    createdBy: uuid('created_by').notNull().references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('entry_payments_movement_idx').on(t.movementId, t.paidAt)]
).enableRLS()


export const entryFolioCounters = pgTable('entry_folio_counters', {
  storeId: bigint('store_id', { mode: 'number' })
    .primaryKey()
    .references(() => stores.id),
  lastSeq: integer('last_seq').notNull().default(0)
}).enableRLS()


/** Cabecera de transferencia entre tiendas. */
export const transfers = pgTable('transfers', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  fromStoreId: bigint('from_store_id', { mode: 'number' })
    .notNull()
    .references(() => stores.id),
  toStoreId: bigint('to_store_id', { mode: 'number' })
    .notNull()
    .references(() => stores.id),
  status: transferStatus('status').notNull().default('pendiente'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => profiles.id),
  note: text('note'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  // Quién confirmó la recepción en destino. Null hasta que status = 'recibida'.
  receivedBy: uuid('received_by').references(() => profiles.id),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  canceledBy: uuid('canceled_by').references(() => profiles.id),
  cancelReason: text('cancel_reason'),
  ...timestamps()
}).enableRLS()

/** Líneas de transferencia: generan salida en origen + entrada en destino. */
export const transferItems = pgTable('transfer_items', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  transferId: bigint('transfer_id', { mode: 'number' })
    .notNull()
    .references(() => transfers.id, { onDelete: 'cascade' }),
  productId: bigint('product_id', { mode: 'number' })
    .notNull()
    .references(() => products.id),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull()
}).enableRLS()

/** Tickets de corrección: el empleado los levanta; el admin los resuelve. */
export const tickets = pgTable('tickets', {
  id: bigint('id', { mode: 'number' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  raisedBy: uuid('raised_by')
    .notNull()
    .references(() => profiles.id),
  storeId: bigint('store_id', { mode: 'number' })
    .notNull()
    .references(() => stores.id),
  target: ticketTarget('target').notNull(),
  invoiceId: bigint('invoice_id', { mode: 'number' }).references(
    () => invoices.id
  ),
  movementId: bigint('movement_id', { mode: 'number' }).references(
    () => stockMovements.id
  ),
  /** target 'gasto': el gasto que se pide anular. */
  expenseId: bigint('expense_id', { mode: 'number' }).references(() => expenses.id),
  reason: text('reason').notNull(),
  status: ticketStatus('status').notNull().default('abierto'),
  resolvedBy: uuid('resolved_by').references(() => profiles.id),
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true })
}).enableRLS()

/** Corte de caja por turno: snapshot de ventas de la tienda desde el corte anterior. */
export const cashCloseouts = pgTable(
  'cash_closeouts',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    // Ventana del corte. period_from null = desde el inicio.
    periodFrom: timestamp('period_from', { withTimezone: true }),
    periodTo: timestamp('period_to', { withTimezone: true }).notNull(),
    // Snapshot de ventas emitidas del periodo.
    salesCount: integer('sales_count').notNull().default(0),
    totalEmitido: numeric('total_emitido', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    totalEfectivo: numeric('total_efectivo', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    // total_tarjeta se partió en débito/crédito (migración 0031). Los 3 cortes
    // históricos que tenían importe ahí se volcaron íntegros a total_debito,
    // igual que las facturas: antes no se distinguía el tipo de tarjeta.
    totalDebito: numeric('total_debito', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    totalCredito: numeric('total_credito', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    totalTransferencia: numeric('total_transferencia', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    // Ventas del periodo anuladas al momento del corte (informativo).
    voidedCount: integer('voided_count').notNull().default(0),
    totalVoided: numeric('total_voided', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [index('cash_closeouts_store_created_idx').on(t.storeId, t.createdAt)]
).enableRLS()

/** Clientes del negocio. */
export const customers = pgTable(
  'customers',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
    rfc: text('rfc'),
    address: text('address'),
    email: text('email'),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps()
  },
  (t) => [unique('customers_rfc_uniq').on(t.rfc)]
).enableRLS()

export const expenseType = pgEnum('expense_type', ['Fijo', 'Operativo'])


export const expenseStatus = pgEnum('expense_status', ['emitido', 'anulado'])


/** IVA vigente. Vive aquí porque la BD lo usa en las columnas generadas de `expenses`. */
export const IVA_RATE = 0.16

/**
 * Cabecera de gasto. `amount` es el SUBTOTAL (suma de `expense_items`).
 *
 * ⚠️ El IVA y las retenciones YA NO SON INFORMATIVOS: lo que se paga es
 * `subtotal + IVA − retenciones`, y eso vive en `total_to_pay`. Antes el
 * pagable era el subtotal pelón y el 16% se calculaba en la app sólo para
 * mostrarlo (a diferencia de las ventas, donde el IVA sigue siendo informativo
 * y `invoices.total_amount` sigue siendo el cobrable).
 */
export const expenses = pgTable(
  'expenses',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    storeId: bigint('store_id', { mode: 'number' })
      .notNull()
      .references(() => stores.id),
    supplier: text('supplier').notNull(),
    supplierInvoiceNumber: text('supplier_invoice_number').notNull(),
    type: expenseType('type').notNull().default('Operativo'),
    /** Importe retenido, no tasa. Se resta de lo que se paga. */
    retentionIva: numeric('retention_iva', { precision: 14, scale: 2 }),
    retentionIsr: numeric('retention_isr', { precision: 14, scale: 2 }),
    // Suma de expense_items.amount al momento de crear/editar (snapshot, igual que invoices.totalAmount).
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    // ─── IVA y pagable: columnas GENERADAS, calculadas por Postgres ───
    // No son snapshots que la app tenga que recordar actualizar: se recalculan
    // solas cada vez que cambia `amount` o una retención. Es a propósito, y es
    // lo que impide el bug que ya pasó una vez aquí — el pagable y lo que la
    // pantalla mostraba se calculaban en dos lugares distintos, divergieron, y
    // entraron pagos inflados (monto × 1.16) que nadie topó. Con esto hay UNA
    // sola definición de "cuánto se debe" y es la de la base; el endpoint de
    // abonos y los reportes la LEEN, no la vuelven a calcular.
    //
    // ⚠️ La tasa está escrita en el DDL: cambiarla es una migración, no un
    // deploy. Es lo correcto para una tasa legal —que no cambie por accidente—
    // pero hay que saberlo antes de prometer "el IVA es configurable".
    iva: numeric('iva', { precision: 14, scale: 2 })
      .notNull()
      .generatedAlwaysAs(sql`round("amount" * 0.16, 2)`),
    /** Lo que realmente se debe pagar: subtotal + IVA − retenciones. */
    totalToPay: numeric('total_to_pay', { precision: 14, scale: 2 })
      .notNull()
      .generatedAlwaysAs(
        sql`"amount" + round("amount" * 0.16, 2) - coalesce("retention_iva", 0) - coalesce("retention_isr", 0)`
      ),
    paidAt: date('paid_at').notNull(),
    note: text('note'),
    /** `anulado` = corregido. No se borra la fila; ver `expenseStatus`. */
    status: expenseStatus('status').notNull().default('emitido'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => profiles.id),
    voidReason: text('void_reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('expenses_store_paid_idx').on(t.storeId, t.paidAt),
    // Una retención mayor que subtotal+IVA dejaría `total_to_pay` en negativo:
    // un gasto que "te deben". Mientras las retenciones eran informativas eso
    // no hacía daño; ahora es el importe que se paga.
    check(
      'expenses_retentions_within_total',
      sql`coalesce(${t.retentionIva}, 0) + coalesce(${t.retentionIsr}, 0)
          <= ${t.amount} + round(${t.amount} * 0.16, 2)`
    )
  ]
).enableRLS()

/** Líneas de gasto: concepto + monto. Análogo a invoice_items pero sin producto/cantidad. */
export const expenseItems = pgTable(
  'expense_items',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    expenseId: bigint('expense_id', { mode: 'number' })
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [index('idx_expense_items_expense_id').on(t.expenseId)]
).enableRLS()

/** Abonos/pagos de un gasto. Un gasto puede pagarse en parcialidades. */
export const expensePayments = pgTable(
  'expense_payments',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    expenseId: bigint('expense_id', { mode: 'number' })
      .notNull()
      .references(() => expenses.id, { onDelete: 'cascade' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    paidBy: text('paid_by').notNull().default('Sin especificar'),
    paidAt: date('paid_at').notNull(),
    method: paymentMethod('method').notNull().default('efectivo'),
    /** Cuenta de la que salió el dinero. NULL = efectivo (ver `bank_accounts`). */
    accountId: bigint('account_id', { mode: 'number' }).references(() => bankAccounts.id),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [index('expense_payments_expense_idx').on(t.expenseId, t.paidAt)]
).enableRLS()


export const cashFlowType = pgEnum('cash_flow_type', [
  /** Abono cobrado de una venta (+). */
  'cobro_venta',
  /** Abono pagado de una entrada de mercancía (−). */
  'pago_entrada',
  /** Abono pagado de un gasto, ya con IVA y retenciones (−). */
  'pago_gasto',
  // ─── LEGADO: ya no se capturan ───
  // Los cuatro siguientes eran los conceptos fijos del alta manual. Se
  // retiraron de la captura por decisión del cliente: el signo forzado de
  // préstamo y retiro peleaba con poder elegirlo, y el saldo inicial limitado a
  // uno por bolsa impedía asentar los saldos que hicieran falta. Hoy todo eso se
  // escribe libre y entra como 'movimiento'.
  //
  // Siguen aquí porque Postgres NO sabe quitar un valor de un enum: borrarlos
  // obligaría a recrear el tipo, como tuvo que hacer la migración 0030 con
  // `payment_method`. No hay ninguna fila con estos valores.
  /** Saldo con el que arranca la cuenta. Puede ser negativo. */
  'saldo_inicial',
  /** Dinero que entra sin documento detrás (+). */
  'prestamo',
  /** Dinero que se saca (−). */
  'retiro',
  /** Corrección manual de cuadre; cualquier signo. */
  'ajuste',
  /** Reversa de otro movimiento de dinero. */
  'anulacion',
  /**
   * Movimiento manual con concepto LIBRE, escrito por quien lo captura
   * (`banks_movements.concept`): nómina, préstamo de un socio, compra de equipo…
   * Cualquier signo, igual que `ajuste`.
   *
   * ⚠️ Va al FINAL de la lista a propósito: así la migración es un
   * `ALTER TYPE … ADD VALUE` barato. Insertarlo en medio obligaría a recrear el
   * enum entero, como tuvo que hacer la 0030 con `payment_method`.
   *
   * Los cuatro conceptos con nombre (`saldo_inicial`, `prestamo`, `retiro`,
   * `ajuste`) NO se van: siguen existiendo porque cada uno lleva una regla que
   * el texto libre no puede llevar —el signo fijo de préstamo y retiro, la
   * unicidad del saldo inicial— y porque los reportes filtran por ellos. Lo que
   * cambia es que ya no son la única opción.
   */
  'movimiento'
])


export const banksMovements = pgTable(
  'banks_movements',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    type: cashFlowType('type').notNull(),
    /** Signo: + entra, − sale. Snapshot: no se recalcula desde el pago. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    /** El `paid_at` del pago que lo originó. */
    occurredAt: date('occurred_at').notNull(),
    /** Cuenta afectada. NULL = efectivo, que es su propia bolsa. */
    accountId: bigint('account_id', { mode: 'number' }).references(
      () => bankAccounts.id
    ),
    /** Procedencia informativa. NULL en los manuales. No da saldos por tienda. */
    storeId: bigint('store_id', { mode: 'number' }).references(() => stores.id),
    // ─── Origen: a lo más UNO de los tres; ninguno = movimiento manual ───
    // ⚠️ `set null` y no `cascade`: anular una venta o una entrada BORRA sus
    // abonos (`voidInvoiceTx`/`voidMovementTx`), y con `cascade` se llevaría
    // por delante el movimiento de dinero — el saldo cambiaría solo, sin dejar
    // rastro de por qué. Con `set null` la fila sobrevive, su reversa
    // (`anulacion`) la deja en cero, y el par queda para auditar. Lo que se
    // pierde es el puntero al abono; por eso `note` guarda el folio.
    salePaymentId: bigint('sale_payment_id', { mode: 'number' }).references(
      () => salePayments.id,
      { onDelete: 'set null' }
    ),
    entryPaymentId: bigint('entry_payment_id', { mode: 'number' }).references(
      () => entryPayments.id,
      { onDelete: 'set null' }
    ),
    expensePaymentId: bigint('expense_payment_id', { mode: 'number' }).references(
      () => expensePayments.id,
      { onDelete: 'set null' }
    ),
    /** Liga la reversa (anulacion) al movimiento original. */
    reversesId: bigint('reverses_id', { mode: 'number' }).references(
      (): AnyPgColumn => banksMovements.id
    ),
    /** Cómo entró/salió el dinero. Snapshot del método del pago. */
    method: paymentMethod('method'),

    concept: text('concept'),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    // Saldo corrido por cuenta y filtros por periodo.
    index('banks_movements_account_occurred_idx').on(t.accountId, t.occurredAt),
 
    unique('banks_movements_sale_payment_uniq').on(t.salePaymentId),
    unique('banks_movements_entry_payment_uniq').on(t.entryPaymentId),
    unique('banks_movements_expense_payment_uniq').on(t.expensePaymentId),
    unique('banks_movements_reverses_uniq').on(t.reversesId),
    check(
      'banks_movements_one_source',
      sql`(CASE WHEN ${t.salePaymentId} IS NULL THEN 0 ELSE 1 END
         + CASE WHEN ${t.entryPaymentId} IS NULL THEN 0 ELSE 1 END
         + CASE WHEN ${t.expensePaymentId} IS NULL THEN 0 ELSE 1 END) <= 1`
    ),
    // El signo lo manda el concepto. Un importe 0 no es un movimiento.
    check(
      'banks_movements_amount_sign',
      sql`CASE ${t.type}
            WHEN 'cobro_venta'  THEN ${t.amount} > 0
            WHEN 'pago_entrada' THEN ${t.amount} < 0
            WHEN 'pago_gasto'   THEN ${t.amount} < 0
            WHEN 'prestamo'     THEN ${t.amount} > 0
            WHEN 'retiro'       THEN ${t.amount} < 0
            ELSE ${t.amount} <> 0
          END`
    ),
    // Una anulación siempre revierte algo; nadie más lleva reverses_id.
    check(
      'banks_movements_reversal_typed',
      sql`(${t.type} = 'anulacion') = (${t.reversesId} IS NOT NULL)`
    ),
 
    check(
      'banks_movements_concept_required',
      sql`${t.type}::text <> 'movimiento' OR (${t.concept} IS NOT NULL AND btrim(${t.concept}) <> '')`
    )
  ]
).enableRLS()






// ───────────────────────────────────────────────
//  RELACIONES
// ───────────────────────────────────────────────

export const profilesRelations = relations(profiles, ({ one, many }) => ({
  store: one(stores, {
    fields: [profiles.storeId],
    references: [stores.id]
  }),
  stockMovements: many(stockMovements),
  invoices: many(invoices),
  transfers: many(transfers),
  raisedTickets: many(tickets, { relationName: 'ticketRaisedBy' }),
  resolvedTickets: many(tickets, { relationName: 'ticketResolvedBy' }),
  cashCloseouts: many(cashCloseouts)
}))

export const storesRelations = relations(stores, ({ many }) => ({
  profiles: many(profiles),
  inventory: many(inventory),
  stockMovements: many(stockMovements),
  invoices: many(invoices),
  transfersFrom: many(transfers, { relationName: 'transferFrom' }),
  transfersTo: many(transfers, { relationName: 'transferTo' }),
  tickets: many(tickets),
  cashCloseouts: many(cashCloseouts)
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'categoryParent'
  }),
  children: many(categories, { relationName: 'categoryParent' }),
  products: many(products)
}))

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id]
  }),
  // Producto base de esta muestra (null en un producto normal). Se usa para
  // resolver el inventario que la muestra descuenta.
  sampleOf: one(products, {
    fields: [products.sampleOfProductId],
    references: [products.id],
    relationName: 'productSample'
  }),
  /** La muestra de este producto (arreglo por la API de Drizzle; a lo más una). */
  samples: many(products, { relationName: 'productSample' }),
  inventory: many(inventory),
  stockMovements: many(stockMovements),
  invoiceItems: many(invoiceItems),
  transferItems: many(transferItems),
  kitItems: many(salesKitItems)
}))

export const salesKitsRelations = relations(salesKits, ({ many }) => ({
  items: many(salesKitItems)
}))

export const salesKitItemsRelations = relations(salesKitItems, ({ one }) => ({
  kit: one(salesKits, {
    fields: [salesKitItems.kitId],
    references: [salesKits.id]
  }),
  product: one(products, {
    fields: [salesKitItems.productId],
    references: [products.id]
  })
}))

export const entryPaymentsRelations = relations(entryPayments, ({ one }) => ({
  movement: one(stockMovements, {
    fields: [entryPayments.movementId],
    references: [stockMovements.id]
  }),
  account: one(bankAccounts, {
    fields: [entryPayments.accountId],
    references: [bankAccounts.id]
  }),
  createdBy: one(profiles, {
    fields: [entryPayments.createdBy],
    references: [profiles.id]
  })
}))

export const customersRelations = relations(customers, ({ many }) => ({
  invoices: many(invoices)
}))

export const inventoryRelations = relations(inventory, ({ one }) => ({
  product: one(products, {
    fields: [inventory.productId],
    references: [products.id]
  }),
  store: one(stores, {
    fields: [inventory.storeId],
    references: [stores.id]
  })
}))

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  store: one(stores, {
    fields: [invoices.storeId],
    references: [stores.id]
  }),
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id]
  }),
  createdBy: one(profiles, {
    fields: [invoices.createdBy],
    references: [profiles.id]
  }),
  voidedBy: one(profiles, {
    fields: [invoices.voidedBy],
    references: [profiles.id]
  }),
  items: many(invoiceItems),
  stockMovements: many(stockMovements),
  payments: many(salePayments)
}))

export const salePaymentsRelations = relations(salePayments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [salePayments.invoiceId],
    references: [invoices.id]
  }),
  account: one(bankAccounts, {
    fields: [salePayments.accountId],
    references: [bankAccounts.id]
  }),
  createdBy: one(profiles, {
    fields: [salePayments.createdBy],
    references: [profiles.id]
  })
}))

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id]
  }),
  product: one(products, {
    fields: [invoiceItems.productId],
    references: [products.id]
  }),
  kit: one(salesKits, {
    fields: [invoiceItems.kitId],
    references: [salesKits.id]
  })
}))

export const stockMovementsRelations = relations(
  stockMovements,
  ({ one, many }) => ({
    product: one(products, {
      fields: [stockMovements.productId],
      references: [products.id]
    }),
    store: one(stores, {
      fields: [stockMovements.storeId],
      references: [stores.id]
    }),
    invoice: one(invoices, {
      fields: [stockMovements.invoiceId],
      references: [invoices.id]
    }),
    transfer: one(transfers, {
      fields: [stockMovements.transferId],
      references: [transfers.id]
    }),
    reverses: one(stockMovements, {
      fields: [stockMovements.reversesMovementId],
      references: [stockMovements.id],
      relationName: 'movementReversal'
    }),
    createdBy: one(profiles, {
      fields: [stockMovements.createdBy],
      references: [profiles.id]
    }),
    payments: many(entryPayments) 
  })
)

export const transfersRelations = relations(transfers, ({ one, many }) => ({
  fromStore: one(stores, {
    fields: [transfers.fromStoreId],
    references: [stores.id],
    relationName: 'transferFrom'
  }),
  toStore: one(stores, {
    fields: [transfers.toStoreId],
    references: [stores.id],
    relationName: 'transferTo'
  }),
  createdBy: one(profiles, {
    fields: [transfers.createdBy],
    references: [profiles.id],
    relationName: 'transfer_created_by'   
  }),
  receivedBy: one(profiles, {
    fields: [transfers.receivedBy],
    references: [profiles.id],
    relationName: 'transfer_received_by'
  }),
  canceledBy: one(profiles, {
    fields: [transfers.canceledBy],
    references: [profiles.id],
    relationName: 'transfer_canceled_by'
  }),
  items: many(transferItems),
  stockMovements: many(stockMovements)
}))

export const transferItemsRelations = relations(transferItems, ({ one }) => ({
  transfer: one(transfers, {
    fields: [transferItems.transferId],
    references: [transfers.id]
  }),
  product: one(products, {
    fields: [transferItems.productId],
    references: [products.id]
  })
}))

export const ticketsRelations = relations(tickets, ({ one }) => ({
  raisedBy: one(profiles, {
    fields: [tickets.raisedBy],
    references: [profiles.id],
    relationName: 'ticketRaisedBy'
  }),
  resolvedBy: one(profiles, {
    fields: [tickets.resolvedBy],
    references: [profiles.id],
    relationName: 'ticketResolvedBy'
  }),
  store: one(stores, {
    fields: [tickets.storeId],
    references: [stores.id]
  }),
  invoice: one(invoices, {
    fields: [tickets.invoiceId],
    references: [invoices.id]
  }),
  movement: one(stockMovements, {
    fields: [tickets.movementId],
    references: [stockMovements.id]
  }),
  expense: one(expenses, {
    fields: [tickets.expenseId],
    references: [expenses.id]
  })
}))

export const cashCloseoutsRelations = relations(cashCloseouts, ({ one }) => ({
  store: one(stores, {
    fields: [cashCloseouts.storeId],
    references: [stores.id]
  }),
  createdBy: one(profiles, {
    fields: [cashCloseouts.createdBy],
    references: [profiles.id]
  })
}))

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  store: one(stores, { fields: [expenses.storeId], references: [stores.id] }),
  createdBy: one(profiles, { fields: [expenses.createdBy], references: [profiles.id] }),
  items: many(expenseItems),
  payments: many(expensePayments),
  tickets: many(tickets)
}))

export const expenseItemsRelations = relations(expenseItems, ({ one }) => ({
  expense: one(expenses, { fields: [expenseItems.expenseId], references: [expenses.id] })
}))

export const bankAccountsRelations = relations(bankAccounts, ({ many }) => ({
  cashFlow: many(banksMovements),
  salePayments: many(salePayments),
  entryPayments: many(entryPayments),
  expensePayments: many(expensePayments)
}))

export const banksMovementsRelations = relations(banksMovements, ({ one }) => ({
  account: one(bankAccounts, {
    fields: [banksMovements.accountId],
    references: [bankAccounts.id]
  }),
  store: one(stores, {
    fields: [banksMovements.storeId],
    references: [stores.id]
  }),
  salePayment: one(salePayments, {
    fields: [banksMovements.salePaymentId],
    references: [salePayments.id]
  }),
  entryPayment: one(entryPayments, {
    fields: [banksMovements.entryPaymentId],
    references: [entryPayments.id]
  }),
  expensePayment: one(expensePayments, {
    fields: [banksMovements.expensePaymentId],
    references: [expensePayments.id]
  }),
  reverses: one(banksMovements, {
    fields: [banksMovements.reversesId],
    references: [banksMovements.id],
    relationName: 'cashFlowReversal'
  }),
  createdBy: one(profiles, {
    fields: [banksMovements.createdBy],
    references: [profiles.id]
  })
}))

export const expensePaymentsRelations = relations(expensePayments, ({ one }) => ({
  expense: one(expenses, { fields: [expensePayments.expenseId], references: [expenses.id] }),
  account: one(bankAccounts, {
    fields: [expensePayments.accountId],
    references: [bankAccounts.id]
  }),
  createdBy: one(profiles, { fields: [expensePayments.createdBy], references: [profiles.id] })
}))

// ───────────────────────────────────────────────
//  TIPOS INFERIDOS (select / insert)
// ───────────────────────────────────────────────
export type Store = typeof stores.$inferSelect
export type NewStore = typeof stores.$inferInsert
export type Profile = typeof profiles.$inferSelect
export type NewProfile = typeof profiles.$inferInsert
export type Category = typeof categories.$inferSelect
export type NewCategory = typeof categories.$inferInsert
export type Product = typeof products.$inferSelect
export type NewProduct = typeof products.$inferInsert
export type InventoryRow = typeof inventory.$inferSelect
export type NewInventoryRow = typeof inventory.$inferInsert
export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
export type InvoiceItem = typeof invoiceItems.$inferSelect
export type NewInvoiceItem = typeof invoiceItems.$inferInsert
export type SalePayment = typeof salePayments.$inferSelect
export type NewSalePayment = typeof salePayments.$inferInsert
export type StockMovement = typeof stockMovements.$inferSelect
export type NewStockMovement = typeof stockMovements.$inferInsert
export type Transfer = typeof transfers.$inferSelect
export type NewTransfer = typeof transfers.$inferInsert
export type TransferItem = typeof transferItems.$inferSelect
export type NewTransferItem = typeof transferItems.$inferInsert
export type Ticket = typeof tickets.$inferSelect
export type NewTicket = typeof tickets.$inferInsert
export type CashCloseout = typeof cashCloseouts.$inferSelect
export type NewCashCloseout = typeof cashCloseouts.$inferInsert
export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert
export type ExpensePayment = typeof expensePayments.$inferSelect
export type NewExpensePayment = typeof expensePayments.$inferInsert
export type ExpenseItem = typeof expenseItems.$inferSelect
export type NewExpenseItem = typeof expenseItems.$inferInsert
export type SalesKit = typeof salesKits.$inferSelect
export type NewSalesKit = typeof salesKits.$inferInsert
export type SalesKitItem = typeof salesKitItems.$inferSelect
export type NewSalesKitItem = typeof salesKitItems.$inferInsert
export type EntryPayment = typeof entryPayments.$inferSelect
export type NewEntryPayment = typeof entryPayments.$inferInsert
export type BanksMovement = typeof banksMovements.$inferSelect
export type NewBanksMovement = typeof banksMovements.$inferInsert
export type BankAccount = typeof bankAccounts.$inferSelect
export type NewBankAccount = typeof bankAccounts.$inferInsert