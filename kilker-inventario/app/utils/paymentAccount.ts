// ───────────────────────────────────────────────
//  MÉTODO DE PAGO ↔ CUENTA BANCARIA
// ───────────────────────────────────────────────
// Espejo en el cliente de `resolvePaymentAccount` (server/utils/cashFlow.ts).
// Los tres modales de pago —ventas, entradas y gastos— necesitan la misma regla
// y aquí vive una sola vez.
//
// ⚠️ Esto solo evita que el usuario mande algo inválido; la autorización y la
// validación de verdad son las del servidor, que devuelve 400.
import type { PaymentMethod } from '~/types/inventario'

/** Todo lo que no es efectivo sale de una cuenta bancaria. */
export function requiresBankAccount(method: PaymentMethod): boolean {
  return method !== 'efectivo'
}

/**
 * La pareja método ↔ cuenta es coherente.
 *
 * ⚠️ La regla va en las DOS direcciones, y la segunda es la que importa: en la
 * base "sin cuenta" y "efectivo" son el mismo estado (`account_id IS NULL`), así
 * que una transferencia sin cuenta no queda "incompleta" — queda registrada como
 * efectivo, y ese peso sale mal contado en dos saldos a la vez.
 */
export function isPaymentAccountValid(
  method: PaymentMethod,
  accountId: number | null | undefined
): boolean {
  return requiresBankAccount(method) ? accountId != null : accountId == null
}
