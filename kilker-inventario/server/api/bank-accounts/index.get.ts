// ───────────────────────────────────────────────
//  GET /api/bank-accounts — catálogo de cuentas bancarias
// ───────────────────────────────────────────────
// Ordenadas por banco y titular; enriquecidas con `paymentCount` (cuántos pagos
// las usan), para saber si una cuenta está en uso antes de tocarla.
//
// ⚠️ A diferencia de /api/stores, /api/products y /api/categories, esta lectura
// NO es pública: exige sesión. Aunque de la tarjeta sólo se guarden 4 dígitos,
// la lista de bancos y titulares de la empresa no tiene por qué estar disponible
// sin autenticar. Cualquier rol autenticado puede leerla porque todos los que
// capturan pagos necesitan elegir cuenta.
//
// ⚠️ **Paginación SOLO si viene `?page`** (mismo contrato que products, sales,
// movements…). Sin `page` devuelve el arreglo completo, y eso NO es un descuido:
// `SelectorCuentaPago.vue` necesita todas las cuentas para ofrecerlas al
// registrar un pago. Si esta respuesta se paginara siempre, el selector se
// quedaría sin la mitad de las cuentas y nadie lo notaría hasta que faltara una
// al cobrar. Filtro `?q` sobre banco, titular y últimos 4.
import { and, asc, count, ilike, or } from 'drizzle-orm'
import { useDb } from '../../db'
import { bankAccounts } from '../../db/schema'
import { countPaymentsByAccount } from '../../utils/bankAccounts'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const db = useDb()
  const query = getQuery(event)

  const q = String(query.q ?? '').trim()
  const filters = []
  if (q) {
    const like = `%${q}%`
    filters.push(
      or(
        ilike(bankAccounts.bank, like),
        ilike(bankAccounts.owner, like),
        ilike(bankAccounts.cardLast4, like)
      )!
    )
  }
  const whereClause = filters.length ? and(...filters) : undefined

  const paginate = query.page != null
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20))

  const rows = await db.query.bankAccounts.findMany({
    where: whereClause,
    orderBy: [asc(bankAccounts.bank), asc(bankAccounts.owner)],
    ...(paginate ? { limit: pageSize, offset: (page - 1) * pageSize } : {})
  })

  // El conteo de pagos se acota a las cuentas que se van a devolver: recorrer
  // las tres tablas de pagos enteras para pintar diez filas sería pagar por
  // todo el histórico del negocio en cada carga.
  const byAccount = await countPaymentsByAccount(
    db,
    rows.map((a) => a.id)
  )
  const mapped = rows.map((a) => ({ ...a, paymentCount: byAccount.get(a.id) ?? 0 }))

  if (!paginate) return mapped

  const total =
    (await db.select({ value: count() }).from(bankAccounts).where(whereClause))[0]?.value ?? 0

  return { data: mapped, total, page, pageSize }
})
