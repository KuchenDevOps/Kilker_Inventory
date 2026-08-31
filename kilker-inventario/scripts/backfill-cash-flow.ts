// scripts/backfill-cash-flow.ts
//
// ───────────────────────────────────────────────
//  BACKFILL DEL FLUJO DE DINERO (banks_movements)
// ───────────────────────────────────────────────
// `banks_movements` se implementó cuando la operación ya llevaba meses corriendo:
// solo asienta los pagos capturados DESPUÉS del deploy. Todo lo cobrado y pagado
// antes existe en `sale_payments`, `entry_payments` y `expense_payments` pero no
// movió un peso en el libro de dinero, así que los saldos por cuenta arrancan
// truncados. Este script asienta ese histórico UNA vez.
//
// Uso (desde kilker-inventario/):
//   npx tsx scripts/backfill-cash-flow.ts             (dry-run: solo imprime)
//   npx tsx scripts/backfill-cash-flow.ts --apply     (escribe)
//
// ⚠️ IDEMPOTENTE, y no por educación: cada origen filtra con `NOT EXISTS` contra
// `banks_movements`, y encima están los únicos `banks_movements_*_payment_uniq`.
// Correrlo dos veces no duplica nada; correrlo después de meses tampoco toca lo
// que la app ya asentó sola.
//
// ⚠️ NO usa `recordPaymentCashFlow` de server/utils/cashFlow.ts a propósito. Esa
// función corre dentro de la transacción de UN pago y necesita `useRuntimeConfig`
// (contexto de Nitro, que aquí no existe). Lo que sí se replica al pie de la
// letra son sus reglas —tipo, signo, fecha, cuenta y formato de la nota—; si
// alguna cambia allá, este script queda viejo, pero también deja de tener sentido
// correrlo (es de un solo uso).
//
// LO QUE **NO** ASIENTA, y por qué:
//   · Pagos de documentos ANULADOS. Anular borra los abonos
//     (`voidInvoiceTx`/`voidMovementTx`), así que si sobrevive alguno es un
//     residuo de mercancía devuelta: ese dinero ya no está. Se cuentan y se
//     reportan, no se asientan.
//   · Abonos con importe <= 0. El check `banks_movements_amount_sign` los
//     rechazaría y tumbaría la transacción completa.
//
// ⚠️ TODOS los pagos históricos traen `account_id` en NULL, incluidos los de
// método `transferencia`: son anteriores al catálogo de cuentas. En la base NULL
// **significa efectivo**, así que este backfill los deja en la bolsa de efectivo.
// El saldo GLOBAL queda correcto; el reparto por cuenta no. Se corrige después,
// documento por documento, con la asignación masiva de cuenta de la UI
// (`AsignarCuentaPagos.vue` → `assignAccountToDocumentPayments`), que mueve el
// pago **y** su movimiento de dinero. El script imprime cuántos quedan así.
import 'dotenv/config' // carga .env → process.env
import { sql, type SQL } from 'drizzle-orm'
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
 * Un origen de dinero.
 *
 * `from` es la MISMA cláusula para el conteo y para el insert: el dry-run no
 * puede mirar un conjunto de filas y el `--apply` escribir otro. Divergir ahí es
 * exactamente el bug que dejó pagos inflados en gastos (dos fórmulas para el
 * mismo número, en dos lugares distintos).
 */
interface Source {
  kind: string
  /** Concepto de `cash_flow_type`. */
  type: string
  /** FROM + JOIN + WHERE, compartido por el resumen y el INSERT. */
  from: SQL
  /** Importe CON signo (+ entra, − sale). */
  amount: SQL
  /** Columna del documento que da la procedencia. */
  storeId: SQL
  /** Nota: guarda el folio, para que el rastro sobreviva al borrado del abono. */
  note: SQL
  /** Cuál de las tres ligas se llena; las otras dos van en NULL. */
  linkColumn: 'sale_payment_id' | 'entry_payment_id' | 'expense_payment_id'
}

const SOURCES: Source[] = [
  {
    kind: 'Cobros de ventas',
    type: 'cobro_venta',
    linkColumn: 'sale_payment_id',
    amount: sql`p.amount`,
    storeId: sql`i.store_id`,
    note: sql`'Cobro venta ' || i.folio`,
    from: sql`
      FROM sale_payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.amount > 0
        AND i.status <> 'anulada'
        AND NOT EXISTS (
          SELECT 1 FROM banks_movements bm WHERE bm.sale_payment_id = p.id
        )
    `
  },
  {
    kind: 'Pagos de entradas',
    type: 'pago_entrada',
    linkColumn: 'entry_payment_id',
    amount: sql`-p.amount`,
    storeId: sql`m.store_id`,
    // Mismo fallback que el endpoint: la entrada puede no tener folio capturado.
    note: sql`'Pago entrada ' || coalesce(m."Folio", m.id::text)`,
    from: sql`
      FROM entry_payments p
      JOIN stock_movements m ON m.id = p.movement_id
      WHERE p.amount > 0
        AND NOT EXISTS (
          SELECT 1 FROM stock_movements r
          WHERE r.type = 'anulacion' AND r.reverses_movement_id = m.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM banks_movements bm WHERE bm.entry_payment_id = p.id
        )
    `
  },
  {
    kind: 'Pagos de gastos',
    type: 'pago_gasto',
    linkColumn: 'expense_payment_id',
    amount: sql`-p.amount`,
    storeId: sql`e.store_id`,
    note: sql`'Pago gasto ' || e.supplier || ' ' || e.supplier_invoice_number`,
    from: sql`
      FROM expense_payments p
      JOIN expenses e ON e.id = p.expense_id
      WHERE p.amount > 0
        AND NOT EXISTS (
          SELECT 1 FROM banks_movements bm WHERE bm.expense_payment_id = p.id
        )
    `
  }
]

interface Summary {
  filas: number
  importe: number
  desde: string | null
  hasta: string | null
  sinCuenta: number
  sinCuentaImporte: number
}

async function summarize(source: Source): Promise<Summary> {
  const rows = await db.execute<{
    filas: number
    importe: string | null
    desde: string | null
    hasta: string | null
    sin_cuenta: number
    sin_cuenta_importe: string | null
  }>(sql`
    SELECT count(*)::int                                        AS filas,
           sum(${source.amount})                                AS importe,
           min(p.paid_at)::text                                 AS desde,
           max(p.paid_at)::text                                 AS hasta,
           count(*) FILTER (
             WHERE p.method <> 'efectivo' AND p.account_id IS NULL
           )::int                                               AS sin_cuenta,
           sum(p.amount) FILTER (
             WHERE p.method <> 'efectivo' AND p.account_id IS NULL
           )                                                    AS sin_cuenta_importe
    ${source.from}
  `)

  const r = rows[0]
  return {
    filas: Number(r?.filas ?? 0),
    importe: Number(r?.importe ?? 0),
    desde: r?.desde ?? null,
    hasta: r?.hasta ?? null,
    sinCuenta: Number(r?.sin_cuenta ?? 0),
    sinCuentaImporte: Number(r?.sin_cuenta_importe ?? 0)
  }
}

/** Lo que se queda fuera, para que no desaparezca en silencio. */
async function reportSkipped() {
  const rows = await db.execute<{
    motivo: string
    filas: number
    importe: string | null
  }>(sql`
    SELECT 'Cobros de ventas ANULADAS' AS motivo, count(*)::int AS filas, sum(p.amount) AS importe
      FROM sale_payments p JOIN invoices i ON i.id = p.invoice_id
     WHERE i.status = 'anulada'
       AND NOT EXISTS (SELECT 1 FROM banks_movements bm WHERE bm.sale_payment_id = p.id)
    UNION ALL
    SELECT 'Pagos de entradas ANULADAS', count(*)::int, sum(p.amount)
      FROM entry_payments p JOIN stock_movements m ON m.id = p.movement_id
     WHERE EXISTS (
             SELECT 1 FROM stock_movements r
              WHERE r.type = 'anulacion' AND r.reverses_movement_id = m.id
           )
       AND NOT EXISTS (SELECT 1 FROM banks_movements bm WHERE bm.entry_payment_id = p.id)
    UNION ALL
    SELECT 'Abonos con importe <= 0', count(*)::int, sum(p.amount) FROM (
            SELECT amount FROM sale_payments    WHERE amount <= 0
      UNION ALL SELECT amount FROM entry_payments   WHERE amount <= 0
      UNION ALL SELECT amount FROM expense_payments WHERE amount <= 0
    ) p
  `)

  const conFilas = rows.filter((r) => Number(r.filas) > 0)
  if (!conFilas.length) return

  console.log('\n⚠️  Abonos que NO se asientan:')
  for (const r of conFilas) {
    console.log(`   · ${r.motivo}: ${r.filas} (${money(Number(r.importe ?? 0))})`)
  }
}

function money(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

async function main() {
  console.log(
    isApply
      ? '🔧 Modo APLICAR — se escribirán movimientos en banks_movements'
      : '🔍 Modo DRY-RUN — solo se muestra qué se asentaría (usa --apply para escribir)'
  )

  const summaries: Array<{ source: Source; summary: Summary }> = []
  for (const source of SOURCES) {
    summaries.push({ source, summary: await summarize(source) })
  }

  console.log('\nPendientes de asentar:')
  let totalFilas = 0
  let totalImporte = 0
  let totalSinCuenta = 0
  let totalSinCuentaImporte = 0

  for (const { source, summary } of summaries) {
    totalFilas += summary.filas
    totalImporte += summary.importe
    totalSinCuenta += summary.sinCuenta
    totalSinCuentaImporte += summary.sinCuentaImporte

    if (!summary.filas) {
      console.log(`   · ${source.kind}: nada pendiente`)
      continue
    }
    console.log(
      `   · ${source.kind}: ${summary.filas} movimientos, ${money(summary.importe)} ` +
        `(${summary.desde} → ${summary.hasta})`
    )
  }

  console.log(`\n   TOTAL: ${totalFilas} movimientos · efecto neto en el saldo ${money(totalImporte)}`)

  await reportSkipped()

  if (totalSinCuenta > 0) {
    console.log(
      `\n⚠️  ${totalSinCuenta} abonos (${money(totalSinCuentaImporte)}) tienen método bancario ` +
        'pero SIN cuenta: son anteriores al catálogo de cuentas.\n' +
        '   Se asientan en la bolsa de EFECTIVO (account_id NULL, que es lo que ese estado\n' +
        '   significa hoy en la base). El saldo global queda correcto; el reparto por cuenta no.\n' +
        '   Para repartirlos: pantalla del documento → "Asignar cuenta a los pagos", que corrige\n' +
        '   el abono y su movimiento de dinero a la vez.'
    )
  }

  if (!totalFilas) {
    console.log('\nNo hay nada que asentar. El libro de dinero ya está al día.')
    return
  }

  if (!isApply) {
    console.log('\nDry-run completo. Corre con --apply para escribir estos movimientos.')
    return
  }

  // Todo en UNA transacción: un libro de dinero a medio poblar es peor que uno
  // vacío, porque nadie sabría desde qué fecha confiar en el saldo.
  const inserted: Array<{ kind: string; filas: number }> = []
  await db.transaction(async (tx) => {
    for (const source of SOURCES) {
      const rows = await tx.execute<{ id: number }>(sql`
        INSERT INTO banks_movements
          (type, amount, occurred_at, account_id, store_id,
           sale_payment_id, entry_payment_id, expense_payment_id,
           method, note, created_by)
        SELECT ${sql.raw(`'${source.type}'`)}::cash_flow_type,
               ${source.amount},
               p.paid_at,
               p.account_id,
               ${source.storeId},
               ${sql.raw(source.linkColumn === 'sale_payment_id' ? 'p.id' : 'NULL')},
               ${sql.raw(source.linkColumn === 'entry_payment_id' ? 'p.id' : 'NULL')},
               ${sql.raw(source.linkColumn === 'expense_payment_id' ? 'p.id' : 'NULL')},
               p.method,
               ${source.note},
               -- El autor del movimiento es quien capturó el abono, no quien corre
               -- el script: el rastro tiene que apuntar a la persona real.
               p.created_by
        ${source.from}
        ORDER BY p.paid_at, p.id
        RETURNING id
      `)
      inserted.push({ kind: source.kind, filas: rows.length })
    }
  })

  console.log('\n✅ Asentado:')
  for (const r of inserted) console.log(`   · ${r.kind}: ${r.filas} movimientos`)

  // Verificación: el libro completo, ya con el histórico dentro.
  const balance = await db.execute<{ cuenta: string; filas: number; saldo: string }>(sql`
    SELECT coalesce(a.bank || ' · ' || a.owner, 'EFECTIVO') AS cuenta,
           count(*)::int                                    AS filas,
           sum(bm.amount)                                   AS saldo
      FROM banks_movements bm
      LEFT JOIN bank_accounts a ON a.id = bm.account_id
     GROUP BY 1
     ORDER BY 1
  `)
  console.log('\nSaldo resultante por cuenta:')
  for (const r of balance) {
    console.log(`   · ${r.cuenta}: ${money(Number(r.saldo))} (${r.filas} movimientos)`)
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
