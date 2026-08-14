// utils/ticket.ts — agrupación de las líneas de una venta para el ticket
import type { ApiSaleItem } from '~/types/inventario'

/**
 * Un renglón del ticket: o un producto suelto (kitId null, una sola línea) o
 * un kit con los productos que lo componen.
 */
export interface TicketGroup {
  key: string
  kitId: number | null
  kitSku: string | null
  kitName: string | null
  kitQuantity: number
  items: ApiSaleItem[]
  /** Importe del grupo antes del descuento de la venta. */
  subtotal: number
}

/**
 * El backend guarda un kit explotado en líneas de producto marcadas con
 * kit_id/kit_sku/kit_name. Para mostrarlo (pantalla o impresión) las volvemos
 * a juntar: cada kit es un bloque con su nombre, SKU y sus componentes; un
 * producto suelto es un grupo de kitId null con una sola línea.
 *
 * El orden de aparición respeta el de `items`: un kit se ancla donde salió su
 * primera línea.
 */
export function groupSaleItemsByKit(items: ApiSaleItem[]): TicketGroup[] {
  const groups: TicketGroup[] = []
  const byKit = new Map<number, TicketGroup>()

  for (const it of items) {
    if (it.kitId == null) {
      groups.push({
        key: `p-${it.id}`,
        kitId: null,
        kitSku: null,
        kitName: null,
        kitQuantity: 0,
        items: [it],
        subtotal: Number(it.lineTotal)
      })
      continue
    }

    let group = byKit.get(it.kitId)
    if (!group) {
      group = {
        key: `k-${it.kitId}`,
        kitId: it.kitId,
        kitSku: it.kitSku,
        kitName: it.kitName,
        kitQuantity: Number(it.kitQuantity ?? 1),
        items: [],
        subtotal: 0
      }
      byKit.set(it.kitId, group)
      groups.push(group)
    }
    group.items.push(it)
    group.subtotal += Number(it.lineTotal)
  }

  return groups
}
