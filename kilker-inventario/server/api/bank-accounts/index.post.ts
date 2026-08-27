// ───────────────────────────────────────────────
//  POST /api/bank-accounts — alta de cuenta bancaria (admin)
// ───────────────────────────────────────────────
// banco y dueño obligatorios; los últimos 4 de la tarjeta son opcionales
// (una cuenta puede no tener plástico).
import { sql } from 'drizzle-orm'
import { useDb } from '../../db'
import { bankAccounts } from '../../db/schema'

interface NewBankAccountBody {
  bank?: string
  owner?: string
  cardLast4?: string | null
}

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default defineEventHandler(async (event) => {
  // Solo admin, igual que sucursales y empleados: es un dato de la empresa, no
  // de la operación diaria de una tienda.
  await requireProfile(event, { role: 'admin' })
  const body = await readBody<NewBankAccountBody>(event)

  const bank = cleanText(body?.bank)
  const owner = cleanText(body?.owner)
  if (!bank) throw createError({ statusCode: 400, statusMessage: 'El banco es obligatorio' })
  if (!owner) {
    throw createError({ statusCode: 400, statusMessage: 'El titular de la cuenta es obligatorio' })
  }

  // ⚠️ Se RECHAZA un número largo, no se recorta a los últimos 4.
  // Recortarlo en silencio enseñaría a capturar el número completo —que para
  // entonces ya viajó en el request y pudo quedar en un log—, y la próxima vez
  // se haría igual. Fallar aquí es lo que hace que no se vuelva costumbre.
  // La base tiene el mismo candado (`bank_accounts_card_last4_format`).
  const rawLast4 = cleanText(body?.cardLast4)
  if (rawLast4 != null && !/^\d{4}$/.test(rawLast4)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Captura SOLO los últimos 4 dígitos de la tarjeta (4 números). ' +
        'El número completo no se guarda en el sistema.'
    })
  }
  const cardLast4 = rawLast4

  const db = useDb()

  // Espejo del unique (bank, owner, card_last4), para dar un 409 legible en vez
  // del error crudo de Postgres.
  // ⚠️ Dos cuentas del mismo banco y titular SIN tarjeta no chocan: en Postgres
  // los NULL no colisionan en un índice único. Es a propósito —una empresa puede
  // tener varias cuentas sin plástico en el mismo banco— pero significa que ahí
  // el duplicado no lo atrapa nadie.
  const dup = await db.query.bankAccounts.findFirst({
    where: (a, { and, eq }) =>
      and(
        sql`lower(${a.bank}) = lower(${bank})`,
        sql`lower(${a.owner}) = lower(${owner})`,
        cardLast4 == null ? sql`${a.cardLast4} is null` : eq(a.cardLast4, cardLast4)
      )
  })
  if (dup) {
    throw createError({
      statusCode: 409,
      statusMessage: cardLast4
        ? `Ya existe una cuenta de ${bank} a nombre de ${owner} terminada en ${cardLast4}`
        : `Ya existe una cuenta de ${bank} a nombre de ${owner} sin tarjeta`
    })
  }

  const [created] = await db
    .insert(bankAccounts)
    .values({ bank, owner, cardLast4 })
    .returning()

  return created
})
