/**
 * Tasa de IVA (16%) y su cálculo, en UN solo lugar del cliente. Estaba copiada
 * en el ticket PDF y en la pantalla de gastos, y una tasa duplicada es una tasa
 * que un día diverge.
 *
 * ⚠️ La tasa es la misma, pero **lo que significa cambia según el documento**:
 * - **Ventas:** el IVA es INFORMATIVO y se calcula aquí. `invoices.total_amount`
 *   es el cobrable y va sin IVA; las ventas se registran sin desglose fiscal
 *   (no hay CFDI/SAT).
 * - **Gastos:** el IVA es parte de lo que se paga y lo calcula POSTGRES, en las
 *   columnas generadas `expenses.iva` y `total_to_pay` (ver `schema.ts`). Del
 *   lado del cliente esto solo sirve para previsualizar el formulario antes de
 *   guardar: el número que manda la base es el que vale, y `ivaOf` redondea a
 *   centavos igual que ella (`round(amount * 0.16, 2)`) para que el preview no
 *   difiera del guardado por un centavo.
 *
 * Cambiar la tasa aquí NO cambia la de los gastos ya guardados: esa vive en la
 * definición de las columnas generadas y mover ese 0.16 exige una migración.
 */
export const IVA_RATE = 0.16

/** IVA de un importe, redondeado a centavos igual que la base. */
export function ivaOf(amount: number): number {
  return Math.round(amount * IVA_RATE * 100) / 100
}
