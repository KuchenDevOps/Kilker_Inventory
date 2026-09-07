// ───────────────────────────────────────────────
//  Helpers compartidos de los cortes de caja
// ───────────────────────────────────────────────
import { and, desc, eq, gt, or, type SQL } from 'drizzle-orm'
import { cashCloseouts } from '../db/schema'

/**
 * Fecha legible para los mensajes de los cortes. Va en hora de México, no en
 * UTC: el servidor corre en UTC (Vercel) y un mensaje que dice "posterior al
 * corte anterior (06:00)" sobre un corte hecho a medianoche no le sirve a nadie
 * en la sucursal.
 */
export function fmtCorteDate(d: Date) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City'
  }).format(d)
}

/**
 * Orden canónico de la cadena de cortes: del más reciente al más antiguo.
 *
 * ⚠️ El desempate por `id` no es decorativo. "El último corte" se pregunta en
 * tres lugares —al calcular el `period_from` del corte nuevo, al decidir si uno
 * se puede borrar y al marcar `isLatest` en el listado— y los tres tienen que
 * responder lo mismo. Con dos cortes al mismo `period_to` (posible: el admin
 * escribe la fecha a mano) y solo esa columna en el ORDER BY, el desempate lo
 * elige Postgres y cada consulta podría quedarse con uno distinto: se borraría
 * un corte que no es el que la pantalla marcó como último.
 */
export const latestCloseoutOrder = [desc(cashCloseouts.periodTo), desc(cashCloseouts.id)]

/** Condición «existe un corte de esta tienda posterior a éste», mismo orden. */
export function newerCloseoutThan(storeId: number, periodTo: Date, id: number): SQL {
  return and(
    eq(cashCloseouts.storeId, storeId),
    or(
      gt(cashCloseouts.periodTo, periodTo),
      and(eq(cashCloseouts.periodTo, periodTo), gt(cashCloseouts.id, id))
    )
  )!
}
