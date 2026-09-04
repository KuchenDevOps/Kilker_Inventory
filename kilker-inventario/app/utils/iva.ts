/**
 * Tasa de IVA (16%) y su cálculo, en UN solo lugar del cliente. Estaba copiada
 * en el ticket PDF y en la pantalla de gastos, y una tasa duplicada es una tasa
 * que un día diverge.
 *
 * ⚠️ En los DOS documentos el IVA es dinero real y lo calcula POSTGRES, en
 * columnas generadas (ver `schema.ts`):
 * - **Gastos:** `expenses.iva` y `expenses.total_to_pay` (= subtotal + IVA −
 *   retenciones). Es lo que se le paga al proveedor.
 * - **Ventas:** `invoices.iva` y `invoices.total_to_pay` (= subtotal + IVA; una
 *   venta no tiene retenciones). Es lo que se le cobra al cliente. Antes el 16%
 *   de las ventas era informativo y se calculaba aquí; ya no.
 *
 * Lo que sigue siendo el SUBTOTAL en los dos es el número del negocio: el gasto
 * y el ingreso. El IVA se entera al SAT, no es ninguno de los dos.
 *
 * Del lado del cliente esto solo sirve para **previsualizar** un formulario
 * antes de guardar (el alta de gasto, el carrito de una venta): el número que
 * manda la base es el que vale, y `ivaOf` redondea a centavos igual que ella
 * (`round(amount * 0.16, 2)`) para que el preview no difiera por un centavo.
 * Para un documento YA guardado, lee `iva`/`totalToPay` de la API — no lo
 * recalcules aquí, que es como nacen las dos definiciones que divergen.
 *
 * Cambiar la tasa aquí NO cambia la de los documentos guardados: esa vive en la
 * definición de las columnas generadas y mover ese 0.16 exige una migración.
 */
export const IVA_RATE = 0.16

/** IVA de un importe, redondeado a centavos igual que la base. */
export function ivaOf(amount: number): number {
  return Math.round(amount * IVA_RATE * 100) / 100
}
