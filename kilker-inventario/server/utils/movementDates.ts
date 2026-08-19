// ───────────────────────────────────────────────
//  FECHA EFECTIVA DE UN MOVIMIENTO DE STOCK
// ───────────────────────────────────────────────
// `supplier_invoice_date` es NULLABLE: las entradas capturadas sin factura de
// proveedor lo tienen en NULL. Filtrar por esa columna a secas hace que esas
// entradas desaparezcan en cuanto se elige cualquier periodo (en SQL,
// `NULL >= '2026-08-01'` es NULL, o sea falso), y reaparezcan al volver a
// "Todo". La fecha efectiva es la de la factura del proveedor cuando existe y,
// si no, la de captura.
//
// Está aquí, en un solo lugar, porque los reportes en TS y los filtros en SQL
// venían divergiendo: el mismo payload del dashboard traía dos cifras de
// "entradas" calculadas con dos reglas de fecha distintas.
import { sql } from 'drizzle-orm'
import { parseBusinessDate } from './businessTime'
import type { SQL } from 'drizzle-orm'
import { stockMovements } from '../db/schema'

/**
 * Fecha efectiva en SQL, como `date`. Se compara contra literales
 * `YYYY-MM-DD` (los mismos que ya usan los endpoints).
 *
 * `created_at` es `timestamptz`; se castea vía UTC para que el resultado no
 * dependa del `TimeZone` de la sesión de Postgres y coincida con lo que
 * calcula `effectiveMovementDate` en TypeScript.
 */
export function effectiveMovementDateSql(): SQL {
  return sql`coalesce(${stockMovements.supplierInvoiceDate}, (${stockMovements.createdAt} at time zone 'UTC')::date)`
}

/** El movimiento cae dentro de `[from, to)`. Cada límite es opcional. */
export function effectiveMovementDateBetween(
  from: string | null,
  to: string | null
): SQL[] {
  const conds: SQL[] = []
  const effective = effectiveMovementDateSql()
  if (from) conds.push(sql`${effective} >= ${from}::date`)
  if (to) conds.push(sql`${effective} < ${to}::date`)
  return conds
}

/** Misma regla, del lado de TypeScript (reconstrucciones FIFO y validaciones). */
export function effectiveMovementDate(movement: {
  supplierInvoiceDate: string | null
  createdAt: Date
}): Date {
  return movement.supplierInvoiceDate
    ? parseBusinessDate(movement.supplierInvoiceDate)
    : movement.createdAt
}
