// ───────────────────────────────────────────────
//  PEDIDOS A PROVEEDORES — piezas compartidas por los endpoints
// ───────────────────────────────────────────────
import { eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { useDb } from '../db'
import { products, profiles, purchaseOrders, stores } from '../db/schema'
import type { UserRole } from './auth'
import { assertNotSample } from './samples'

/** Quién aprueba o rechaza un pedido. Espejo en la UI: PURCHASE_ORDER_APPROVER_ROLES. */
export const PURCHASE_ORDER_APPROVER_ROLES: UserRole[] = ['admin', 'admin_tienda']

export const PURCHASE_ORDER_STATUSES = ['pendiente', 'aprobado', 'rechazado'] as const
export type PurchaseOrderStatusValue = (typeof PURCHASE_ORDER_STATUSES)[number]

export function isPurchaseOrderStatus(v: unknown): v is PurchaseOrderStatusValue {
  return typeof v === 'string' && (PURCHASE_ORDER_STATUSES as readonly string[]).includes(v)
}

/**
 * Valida las líneas del body y las resuelve contra el catálogo (snapshot de
 * SKU y nombre). Va FUERA de la transacción: es una lectura del catálogo y el
 * pedido no depende de existencias, así que no hay nada que bloquear.
 */
export async function resolveOrderLines(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'El pedido necesita al menos un producto' })
  }

  const parsed = raw.map((l, i) => {
    const productId = Number(l?.productId)
    const quantity = Number(l?.quantity)
    const unitPrice = Number(l?.unitPrice)
    const n = i + 1
    if (!Number.isInteger(productId) || productId <= 0) {
      throw createError({ statusCode: 400, statusMessage: `Renglón ${n}: elige un producto` })
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw createError({ statusCode: 400, statusMessage: `Renglón ${n}: la cantidad debe ser mayor a 0` })
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw createError({ statusCode: 400, statusMessage: `Renglón ${n}: el precio no puede ser negativo` })
    }
    return { productId, quantity, unitPrice }
  })

  const ids = [...new Set(parsed.map((p) => p.productId))]
  if (ids.length !== parsed.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Hay productos repetidos: junta las cantidades en un solo renglón'
    })
  }

  const rows = await useDb()
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      isActive: products.isActive,
      sampleOfProductId: products.sampleOfProductId
    })
    .from(products)
    .where(inArray(products.id, ids))
  const byId = new Map(rows.map((r) => [r.id, r]))

  return parsed.map((p) => {
    const prod = byId.get(p.productId)
    if (!prod) {
      throw createError({ statusCode: 400, statusMessage: `El producto ${p.productId} no existe` })
    }
    if (!prod.isActive) {
      throw createError({ statusCode: 400, statusMessage: `${prod.sku} está desactivado` })
    }
    // Una muestra no se compra: se pide el producto base.
    assertNotSample(prod, 'pedir a un proveedor')
    return {
      productId: prod.id,
      sku: prod.sku,
      name: prod.name,
      quantity: String(p.quantity),
      unitPrice: p.unitPrice.toFixed(2)
    }
  })
}

/**
 * Cabecera del pedido con sucursal, autores y totales. La comparten el listado
 * y el detalle para que los dos devuelvan exactamente la misma forma.
 * El total sale de `line_total` (columna generada): nadie lo recalcula.
 */
export function purchaseOrdersBaseQuery() {
  const creator = alias(profiles, 'po_creator')
  const decider = alias(profiles, 'po_decider')
  return useDb()
    .select({
      id: purchaseOrders.id,
      storeId: purchaseOrders.storeId,
      storeName: stores.name,
      storeCode: stores.code,
      supplierName: purchaseOrders.supplierName,
      supplierContact: purchaseOrders.supplierContact,
      note: purchaseOrders.note,
      status: purchaseOrders.status,
      createdAt: purchaseOrders.createdAt,
      updatedAt: purchaseOrders.updatedAt,
      createdByName: creator.fullName,
      decidedAt: purchaseOrders.decidedAt,
      decidedByName: decider.fullName,
      decisionNote: purchaseOrders.decisionNote,
      itemsCount: sql<number>`(select count(*) from purchase_order_items poi where poi.order_id = ${purchaseOrders.id})`.mapWith(Number),
      total: sql<string>`(select coalesce(sum(poi.line_total), 0) from purchase_order_items poi where poi.order_id = ${purchaseOrders.id})`
    })
    .from(purchaseOrders)
    .innerJoin(stores, eq(stores.id, purchaseOrders.storeId))
    .leftJoin(creator, eq(creator.id, purchaseOrders.createdBy))
    .leftJoin(decider, eq(decider.id, purchaseOrders.decidedBy))
    .$dynamic()
}

/**
 * Folio de presentación: ORD-0001. No se guarda, se deriva del id.
 * Mismo prefijo que purchaseOrderFolio (app/types/inventario.ts).
 */
export function purchaseOrderFolioSql() {
  return sql`'ORD-' || lpad(${purchaseOrders.id}::text, 4, '0')`
}