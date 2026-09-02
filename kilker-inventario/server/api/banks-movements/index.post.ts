// ───────────────────────────────────────────────
//  POST /api/banks-movements — movimiento de dinero MANUAL (admin)
// ───────────────────────────────────────────────
// El dinero que NO viene de un documento: el saldo con el que arranca una
// cuenta, la nómina, un préstamo, la compra de un equipo… Los tres conceptos
// derivados de un pago (`cobro_venta`, `pago_entrada`, `pago_gasto`) y las
// `anulacion` los asienta la app sola: ver `recordPaymentCashFlow` en
// server/utils/cashFlow.ts.
//
// ⚠️ EL CONCEPTO ES TEXTO LIBRE Y NO LLEVA NINGUNA REGLA. Todo lo que se captura
// aquí entra como `type = 'movimiento'`, con el sentido —entra o sale— que elija
// quien lo registra. No hay conceptos reservados, ni signos forzados, ni límites
// de cuántos movimientos del mismo tipo puede haber: el cliente decide qué
// asienta, incluso si a primera vista no tiene lógica.
//
// ⚠️ La consecuencia es que aquí NO se atrapa un error de captura. Es a
// propósito: la corrección de movimientos mal capturados va a llegar como su
// propio sistema, y adelantar candados a medias aquí solo estorbaría —fue lo que
// pasó con los conceptos fijos que este endpoint tenía antes—. Mientras tanto,
// un movimiento equivocado se compensa con otro en sentido contrario, que es lo
// que el libro append-only permite.
//
// ⚠️ Solo admin. Esto mete o saca dinero sin nada que lo respalde, así que es de
// la familia de "anular una venta", no de la de "registrar un pago".
import { eq } from 'drizzle-orm'
import { useDb } from '../../db'
import { banksMovements, bankAccounts, paymentMethod, stores } from '../../db/schema'
import { resolvePaymentAccount } from '../../utils/cashFlow'

const ALLOWED_METHODS = paymentMethod.enumValues
const CONCEPT_MAX = 80

interface Body {
  /** Concepto en palabras del usuario. Obligatorio, y sin lista cerrada. */
  concept?: string
  /** Importe SIEMPRE positivo; el signo lo pone `direction`. */
  amount?: number | string
  /** 'in' entra (+), 'out' sale (−). */
  direction?: string
  /** `YYYY-MM-DD`. */
  occurredAt?: string
  method?: string
  /** Cuenta afectada. null = efectivo, que es su propia bolsa. */
  accountId?: number | string | null
  /** Procedencia informativa. Opcional: un retiro no es de ninguna sucursal. */
  storeId?: number | string | null
  note?: string
}

export default defineEventHandler(async (event) => {
  const profile = await requireProfile(event, { role: 'admin' })
  const body = await readBody<Body>(event)

  const concept = String(body?.concept ?? '').trim()
  if (!concept) {
    throw createError({ statusCode: 400, statusMessage: 'El concepto es obligatorio' })
  }
  if (concept.length > CONCEPT_MAX) {
    throw createError({
      statusCode: 400,
      statusMessage: `El concepto no puede pasar de ${CONCEPT_MAX} caracteres; el detalle va en la nota`
    })
  }

  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'El importe debe ser mayor a cero; el sentido se elige aparte'
    })
  }

  // El signo lo pone el servidor a partir del sentido, y el importe viaja
  // siempre positivo. Es la misma decisión que en `recordPaymentCashFlow`:
  // dejar que el cliente mande el signo abre la puerta a que un día lo mande al
  // revés y el saldo se mueva para el otro lado sin que nada lo delate.
  const direction = String(body?.direction ?? '')
  if (direction !== 'in' && direction !== 'out') {
    throw createError({ statusCode: 400, statusMessage: 'Indica si el dinero entra o sale' })
  }
  const sign = direction === 'in' ? 1 : -1

  const occurredAt = String(body?.occurredAt ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
    throw createError({ statusCode: 400, statusMessage: 'La fecha del movimiento es obligatoria' })
  }

  const method = ALLOWED_METHODS.includes(body?.method as never)
    ? (body!.method as (typeof ALLOWED_METHODS)[number])
    : 'efectivo'
  // Misma regla método ↔ cuenta que los tres endpoints de pago, y por el mismo
  // motivo: en la base "sin cuenta" y "efectivo" son el mismo estado, así que una
  // transferencia sin cuenta no queda incompleta — queda contada en la bolsa de
  // efectivo, mal, y nada lo delata.
  const accountId = resolvePaymentAccount(method, body?.accountId)

  const note = String(body?.note ?? '').trim()

  const rawStoreId = body?.storeId == null ? null : Number(body.storeId)
  if (rawStoreId != null && !rawStoreId) {
    throw createError({ statusCode: 400, statusMessage: 'Sucursal inválida' })
  }

  const db = useDb()

  if (accountId != null) {
    const account = await db.query.bankAccounts.findFirst({
      where: eq(bankAccounts.id, accountId)
    })
    if (!account) throw createError({ statusCode: 404, statusMessage: 'La cuenta no existe' })
    // Igual que en la asignación masiva de cuenta: mover dinero a una cuenta dada
    // de baja revive un saldo que se cerró a propósito.
    if (!account.isActive) {
      throw createError({
        statusCode: 400,
        statusMessage: `La cuenta ${account.bank} · ${account.owner} está desactivada`
      })
    }
  }

  if (rawStoreId != null) {
    const store = await db.query.stores.findFirst({ where: eq(stores.id, rawStoreId) })
    if (!store) throw createError({ statusCode: 404, statusMessage: 'La sucursal no existe' })
  }

  // Un solo INSERT: no hay estado que leer antes de decidir, así que tampoco hay
  // transacción ni candado que tomar. (Los tenía cuando el saldo inicial estaba
  // limitado a uno por bolsa; sin esa regla, sobraban.)
  const [created] = await db
    .insert(banksMovements)
    .values({
      type: 'movimiento',
      amount: String(sign * amount),
      occurredAt,
      accountId,
      storeId: rawStoreId,
      method,
      concept,
      note: note || null,
      createdBy: profile.id
    })
    .returning()

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'No se pudo registrar el movimiento' })
  }
  return created
})
