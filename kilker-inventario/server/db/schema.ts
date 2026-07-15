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
export const userRole = pgEnum('user_role', ['admin', 'empleado'])

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

export const ticketTarget = pgEnum('ticket_target', ['factura', 'movimiento'])

export const productUnit = pgEnum('product_unit', ['litro', 'galon', 'cubeta', 'pieza', 'cuarto', 'tambo'])

export const paymentMethod = pgEnum('payment_method', ['efectivo', 'tarjeta', 'transferencia'])

/** Descuentos: enum listo para v2. */
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
  ...timestamps()
}).enableRLS()

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
    
    // Método de pago (corte de caja separa efectivo/tarjeta).
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
  // v2: null en v1.
  discountType: discountType('discount_type'),
  discountValue: numeric('discount_value', { precision: 14, scale: 2 }),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 })
}).enableRLS()

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
    totalTarjeta: numeric('total_tarjeta', { precision: 14, scale: 2 })
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
    reason: text('reason').notNull(),
    retentionIva: numeric('retention_iva', { precision: 14, scale: 2 }),
    retentionIsr: numeric('retention_isr', { precision: 14, scale: 2 }),
    // Monto base (subtotal, sin IVA). El total a pagar se calcula:
    // amount * 1.16 - retentionIva - retentionIsr.
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    // Fecha de la factura del proveedor (no necesariamente cuándo se pagó).
    paidAt: date('paid_at').notNull(),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [index('expenses_store_paid_idx').on(t.storeId, t.paidAt)]
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
    paidAt: date('paid_at').notNull(),
    method: paymentMethod('method').notNull().default('efectivo'),
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
  inventory: many(inventory),
  stockMovements: many(stockMovements),
  invoiceItems: many(invoiceItems),
  transferItems: many(transferItems)
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
  stockMovements: many(stockMovements)
}))

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id]
  }),
  product: one(products, {
    fields: [invoiceItems.productId],
    references: [products.id]
  })
}))

export const stockMovementsRelations = relations(
  stockMovements,
  ({ one }) => ({
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
    })
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
    references: [profiles.id]
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
  payments: many(expensePayments)
}))

export const expensePaymentsRelations = relations(expensePayments, ({ one }) => ({
  expense: one(expenses, { fields: [expensePayments.expenseId], references: [expenses.id] }),
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
