// scripts/fix-reversal-dates.ts
//
// ───────────────────────────────────────────────
//  RE-FECHADO DE LAS ANULACIONES DE banks_movements
// ───────────────────────────────────────────────
// `reversePaymentCashFlowTx` fechaba la reversa el día en que se anulaba
// ("el dinero se devuelve hoy"). Hoy la fecha con la del movimiento que anula,
// porque en esta app anular BORRA el abono: no queda un pago devuelto con fecha
// propia, queda un asiento retirado. Con la fecha vieja, el mes del cobro seguía
// reportando para siempre dinero que ya no existe y el mes de la anulación
// arrastraba una salida que nunca ocurrió ahí.
//
// Este script alinea las reversas que YA se asentaron con la regla nueva.
//
// Uso (desde kilker-inventario/):
//   npx tsx scripts/fix-reversal-dates.ts             (dry-run: solo imprime)
//   npx tsx scripts/fix-reversal-dates.ts --apply     (escribe)
//
// ⚠️ IDEMPOTENTE: el `WHERE` exige que las dos fechas difieran, así que correrlo
// dos veces no toca nada la segunda. Correrlo dentro de un mes tampoco toca las
// reversas que la app ya asentó bien.
//
// ⚠️ Es un UPDATE sobre `banks_movements`, y no rompe el append-only del libro.
// No se toca importe, signo, tipo, cuenta ni la liga `reverses_id` —nada de lo
// que el libro protege— y no se borra ni se agrega una fila: se corrige EN QUÉ
// PERIODO se ve una reversa que siempre existió. Es el mismo permiso que ya se
// da `assignAccountToDocumentPayments` para corregir la cuenta de un movimiento
// ya asentado. Tampoco hay trigger que lo impida: el append-only duro
// (migración 0001) es de `stock_movements`, no de esta tabla.
//
// ⚠️ EL SALDO POR CUENTA NO CAMBIA, y el script lo verifica al final. La reversa
// netea contra su original con cualquier fecha; lo único que se mueve es el neto
// por periodo (`filteredNet` de /cuentas/movimientos y el flujo del dashboard).
// Por eso el dry-run imprime mes por mes cuánto cambia: ése es el efecto real.
import 'dotenv/config' // carga .env → process.env
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../server/db/schema'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error(
    'Falta DATABASE_URL en tu .env — no se puede correr el script sin conexión a la base.'
  )
}

// Mismo patrón que server/db/index.ts: prepare:false por el pooler Supavisor.
const client = postgres(databaseUrl, { prepare: false })
const db = drizzle(client, { schema })

const isApply = process.argv.includes('--apply')

/**
 * Las reversas mal fechadas.
 *
 * ⚠️ La MISMA cláusula la usan el resumen, el detalle, el efecto por mes y el
 * UPDATE. El dry-run no puede mirar un conjunto de filas y el `--apply` escribir
 * otro: divergir ahí es el bug que dejó pagos inflados en gastos (dos fórmulas
 * para el mismo número, en dos lugares distintos).
 */
const DESALINEADAS = sql`
  FROM banks_movements r
  JOIN banks_movements o ON o.id = r.reverses_id
 WHERE r.type = 'anulacion'
   AND r.occurred_at <> o.occurred_at
`

function money(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

async function balancePorCuenta() {
  const rows = await db.execute<{ cuenta: string; filas: number; saldo: string }>(sql`
    SELECT coalesce(a.bank || ' · ' || a.owner, 'EFECTIVO') AS cuenta,
           count(*)::int                                    AS filas,
           sum(bm.amount)                                   AS saldo
      FROM banks_movements bm
      LEFT JOIN bank_accounts a ON a.id = bm.account_id
     GROUP BY 1
     ORDER BY 1
  `)
  return rows.map((r) => ({
    cuenta: r.cuenta,
    filas: Number(r.filas),
    saldo: Number(r.saldo ?? 0)
  }))
}

async function main() {
  console.log(
    isApply
      ? '🔧 Modo APLICAR — se re-fecharán las anulaciones de banks_movements'
      : '🔍 Modo DRY-RUN — solo se muestra qué cambiaría (usa --apply para escribir)'
  )

  const [resumen] = await db.execute<{
    filas: number
    importe: string | null
    dias_min: number | null
    dias_max: number | null
  }>(sql`
    SELECT count(*)::int                             AS filas,
           sum(abs(r.amount))                        AS importe,
           min(r.occurred_at - o.occurred_at)::int   AS dias_min,
           max(r.occurred_at - o.occurred_at)::int   AS dias_max
    ${DESALINEADAS}
  `)

  const filas = Number(resumen?.filas ?? 0)
  if (!filas) {
    console.log('\nNo hay anulaciones desalineadas. El libro de dinero ya está al día.')
    return
  }

  console.log(
    `\n${filas} anulaciones fechadas fuera del movimiento que anulan ` +
      `(${money(Number(resumen?.importe ?? 0))} en valor absoluto).\n` +
      `   Desfase: entre ${resumen?.dias_min} y ${resumen?.dias_max} días.`
  )

  // Fila por fila: qué se anuló, cuándo quedó asentada y a qué fecha se mueve.
  // Con el folio del documento (vive en `note`, porque la liga al abono se
  // pierde al borrarlo) para poder cotejar contra la venta o el gasto real.
  const detalle = await db.execute<{
    id: number
    importe: string
    de: string
    a: string
    cuenta: string
    nota: string | null
  }>(sql`
    SELECT r.id                AS id,
           r.amount            AS importe,
           r.occurred_at::text AS de,
           o.occurred_at::text AS a,
           -- Con subconsulta y no con un LEFT JOIN: DESALINEADAS ya trae su
           -- WHERE, así que ningún join puede colgarse después de ella.
           coalesce(
             (SELECT ba.bank || ' · ' || ba.owner
                FROM bank_accounts ba
               WHERE ba.id = r.account_id),
             'EFECTIVO'
           )                   AS cuenta,
           coalesce(r.note, o.note) AS nota
    ${DESALINEADAS}
    ORDER BY o.occurred_at, r.id
  `)

  console.log('\nDetalle:')
  for (const r of detalle) {
    console.log(
      `   · #${r.id} ${money(Number(r.importe))} · ${r.de} → ${r.a} · ${r.cuenta}` +
        (r.nota ? ` · ${r.nota}` : '')
    )
  }

  // El efecto REAL del cambio: el importe sale del mes en que está fechada la
  // reversa y entra al mes del movimiento que anula. El saldo total no se mueve
  // (las dos mitades suman cero), pero el neto de cada mes sí.
  const porMes = await db.execute<{ mes: string; delta: string }>(sql`
    SELECT mes, sum(delta) AS delta FROM (
      SELECT to_char(o.occurred_at, 'YYYY-MM') AS mes,  r.amount AS delta ${DESALINEADAS}
      UNION ALL
      SELECT to_char(r.occurred_at, 'YYYY-MM') AS mes, -r.amount AS delta ${DESALINEADAS}
    ) x
     GROUP BY mes
    HAVING sum(delta) <> 0
     ORDER BY mes
  `)

  if (porMes.length) {
    console.log('\nCambio en el neto de cada mes (el saldo total NO cambia):')
    for (const r of porMes) {
      const delta = Number(r.delta)
      console.log(`   · ${r.mes}: ${delta > 0 ? '+' : ''}${money(delta)}`)
    }
  }

  if (!isApply) {
    console.log('\nDry-run completo. Corre con --apply para re-fechar estas anulaciones.')
    return
  }

  // Saldo ANTES, para probar contra el de después que esto no movió dinero.
  const saldoAntes = await balancePorCuenta()

  const actualizadas = await db.execute<{ id: number }>(sql`
    UPDATE banks_movements r
       SET occurred_at = o.occurred_at
      FROM banks_movements o
     WHERE o.id = r.reverses_id
       AND r.type = 'anulacion'
       AND r.occurred_at <> o.occurred_at
    RETURNING r.id
  `)

  console.log(`\n✅ Re-fechadas ${actualizadas.length} anulaciones.`)

  // Verificación: si algún saldo se movió, el UPDATE tocó algo que no debía.
  const saldoDespues = await balancePorCuenta()
  const movidas = saldoDespues.filter(
    (d) =>
      Math.abs(d.saldo - (saldoAntes.find((a) => a.cuenta === d.cuenta)?.saldo ?? 0)) > 0.004
  )

  console.log('\nSaldo por cuenta (igual que antes: ésa es la verificación):')
  for (const r of saldoDespues) {
    console.log(`   · ${r.cuenta}: ${money(r.saldo)} (${r.filas} movimientos)`)
  }
  if (movidas.length) {
    throw new Error(
      'El saldo de una cuenta cambió al re-fechar. Re-fechar NO debe mover dinero: ' +
        'revísalo antes de confiar en el libro.'
    )
  }
}

main()
  .then(async () => {
    await client.end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('Error corriendo el script:', err)
    await client.end()
    process.exit(1)
  })
