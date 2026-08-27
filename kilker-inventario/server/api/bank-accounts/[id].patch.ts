// ───────────────────────────────────────────────
//  PATCH /api/bank-accounts/:id — editar cuenta bancaria (admin)
// ───────────────────────────────────────────────
// Edita banco, titular, últimos 4 y estado.
//
// ⚠️ Los últimos 4 NO son editables una vez que la cuenta tiene pagos. Ver la
// nota larga abajo: no es una restricción cosmética.
import { eq, sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { bankAccounts } from '../../db/schema'
import { countPaymentsForAccount } from '../../utils/bankAccounts'

interface PatchBankAccountBody {
  bank?: string
  owner?: string
  cardLast4?: string | null
  isActive?: boolean
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  await requireProfile(event, { role: 'admin' })

  const id = Number(getRouterParam(event, 'id'))
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id inválido' })

  const body = await readBody<PatchBankAccountBody>(event)
  const db = useDb()

  const current = await db.query.bankAccounts.findFirst({ where: eq(bankAccounts.id, id) })
  if (!current) throw createError({ statusCode: 404, statusMessage: 'La cuenta no existe' })

  // Cuántos pagos cuelgan de esta cuenta. Se necesita para decidir si los
  // últimos 4 son editables, y se devuelve para que la UI pueda avisar del
  // alcance de una desactivación.
  const paymentCount = await countPaymentsForAccount(db, id)

  const patch: {
    bank?: string
    owner?: string
    cardLast4?: string | null
    isActive?: boolean
  } = {}

  if (body?.bank !== undefined) {
    const bank = cleanText(body.bank)
    if (!bank) throw createError({ statusCode: 400, statusMessage: 'El banco es obligatorio' })
    patch.bank = bank
  }

  if (body?.owner !== undefined) {
    const owner = cleanText(body.owner)
    if (!owner) {
      throw createError({ statusCode: 400, statusMessage: 'El titular es obligatorio' })
    }
    patch.owner = owner
  }

  if (body?.cardLast4 !== undefined) {
    const raw = cleanText(body.cardLast4)
    if (raw != null && !/^\d{4}$/.test(raw)) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'Captura SOLO los últimos 4 dígitos de la tarjeta (4 números). ' +
          'El número completo no se guarda en el sistema.'
      })
    }

    // ⚠️ Los últimos 4 identifican el plástico. Cambiarlos en una cuenta que ya
    // tiene pagos no corrige un dato: reatribuye TODO su historial a una tarjeta
    // distinta, en silencio y sin dejar rastro — los movimientos de dinero
    // apuntan a la cuenta por id, así que de golpe dirían haber salido de un
    // plástico del que nunca salieron. Un typo en el banco o en el titular es un
    // error de captura y se corrige; un last4 distinto es OTRA cuenta, y esa se
    // da de alta aparte y se desactiva ésta.
    //
    // El banco y el titular sí se editan siempre: son etiquetas, no identidad.
    if (raw !== current.cardLast4 && paymentCount > 0) {
      throw createError({
        statusCode: 409,
        statusMessage:
          `No se pueden cambiar los últimos 4 dígitos: esta cuenta ya tiene ${paymentCount} pago(s) ` +
          'registrados y quedarían atribuidos a otra tarjeta. Da de alta la cuenta nueva y desactiva ésta.'
      })
    }
    patch.cardLast4 = raw
  }

  if (body?.isActive !== undefined) {
    patch.isActive = Boolean(body.isActive)
  }

  if (Object.keys(patch).length === 0) return { ...current, paymentCount }

  // Espejo del unique (bank, owner, card_last4) para dar un 409 legible en vez
  // del error crudo de Postgres. Se evalúa con los valores RESULTANTES, no con
  // los del body: editar sólo el titular puede chocar contra otra cuenta igual.
  const nextBank = patch.bank ?? current.bank
  const nextOwner = patch.owner ?? current.owner
  const nextLast4 = patch.cardLast4 !== undefined ? patch.cardLast4 : current.cardLast4

  const dup = await db.query.bankAccounts.findFirst({
    where: (a, { and, eq: eqc, ne }) =>
      and(
        ne(a.id, id),
        sql`lower(${a.bank}) = lower(${nextBank})`,
        sql`lower(${a.owner}) = lower(${nextOwner})`,
        nextLast4 == null ? sql`${a.cardLast4} is null` : eqc(a.cardLast4, nextLast4)
      )
  })
  if (dup) {
    throw createError({
      statusCode: 409,
      statusMessage: nextLast4
        ? `Ya existe otra cuenta de ${nextBank} a nombre de ${nextOwner} terminada en ${nextLast4}`
        : `Ya existe otra cuenta de ${nextBank} a nombre de ${nextOwner} sin tarjeta`
    })
  }

  const [updated] = await db
    .update(bankAccounts)
    .set(patch)
    .where(eq(bankAccounts.id, id))
    .returning()

  // ⚠️ Desactivar NO borra ni desliga nada: los pagos históricos siguen
  // apuntando aquí y sus movimientos de dinero siguen contando en el saldo. Lo
  // único que cambia es que la cuenta deja de ofrecerse para pagos nuevos
  // (baja suave, igual que productos, sucursales, clientes y empleados).
  return { ...updated!, paymentCount }
})
