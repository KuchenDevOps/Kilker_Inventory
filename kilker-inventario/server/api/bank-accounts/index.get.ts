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
import { useDb } from '../../db'
import { countPaymentsByAccount } from '../../utils/bankAccounts'

export default defineEventHandler(async (event) => {
  await requireProfile(event)
  const db = useDb()

  const [rows, byAccount] = await Promise.all([
    db.query.bankAccounts.findMany({
      orderBy: (a, { asc }) => [asc(a.bank), asc(a.owner)]
    }),
    countPaymentsByAccount(db)
  ])

  return rows.map((a) => ({ ...a, paymentCount: byAccount.get(a.id) ?? 0 }))
})
