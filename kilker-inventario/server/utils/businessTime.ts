// ───────────────────────────────────────────────
//  ZONA HORARIA DEL NEGOCIO
// ───────────────────────────────────────────────
// `supplier_invoice_date` (y cualquier columna `date`) no trae hora. Al pasarla
// a `Date`, JavaScript la interpreta como medianoche UTC. Los periodos del
// dashboard, en cambio, los arma el navegador en hora local: el corte de mes
// sale como `2026-06-01T06:00:00Z`. Con las dos reglas mezcladas, una entrada
// fechada el día 1 caía SEIS HORAS antes del inicio de su propio mes, o sea en
// el inventario del mes anterior — mientras "Compras" la contaba en el suyo.
//
// El offset va fijo y no se hereda del entorno a propósito: en Vercel el
// servidor corre en UTC, así que confiar en la hora local del proceso
// reintroduciría el mismo desfase en producción.
//
// ⚠️ SUPUESTO: todas las sucursales operan en el centro de México (UTC−6 todo
// el año; el país dejó el horario de verano en octubre de 2022). Si más
// adelante hay sucursales en Quintana Roo (UTC−5) o Baja California (con
// horario de verano), esto tiene que pasar a ser por sucursal.
// Registrado en docs/CONTEXTO.md → "Preguntas abiertas".

/** Offset fijo del centro de México. */
export const BUSINESS_UTC_OFFSET = '-06:00'

/** Una fecha sin hora (`YYYY-MM-DD`) es medianoche del negocio, no de UTC. */
export function parseBusinessDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00${BUSINESS_UTC_OFFSET}`)
}

const [, offsetSign = '-', offsetHours = '06', offsetMinutes = '00'] =
  /^([+-])(\d{2}):(\d{2})$/.exec(BUSINESS_UTC_OFFSET) ?? []
const OFFSET_MS =
  (offsetSign === '-' ? -1 : 1) *
  (Number(offsetHours) * 60 + Number(offsetMinutes)) *
  60_000

/**
 * Inversa de `parseBusinessDate`: el día del negocio (`YYYY-MM-DD`) en que cayó
 * un instante. Es lo que hay que usar para llenar cualquier columna `date` a
 * partir de un `timestamptz`.
 *
 * ⚠️ NO usar `toISOString().slice(0, 10)` a secas: una venta de las 8 de la
 * noche en México es ya el día siguiente en UTC, así que ese atajo la asienta
 * en el día equivocado — el mismo desfase de seis horas que documenta el
 * encabezado de este archivo.
 */
export function businessDateOnly(instant: Date): string {
  return new Date(instant.getTime() + OFFSET_MS).toISOString().slice(0, 10)
}
