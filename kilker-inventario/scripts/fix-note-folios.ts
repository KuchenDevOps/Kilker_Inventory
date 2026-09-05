// scripts/fix-note-folios.ts
//
// ───────────────────────────────────────────────
//  FOLIO EN VEZ DE ID INTERNO EN LAS NOTAS DEL LIBRO DE DINERO
// ───────────────────────────────────────────────
// `deleteDocumentPaymentTx` escribía la nota con el id de la tabla
// ("Borrado de un pago de la venta #243"). Ya escribe el folio, pero las notas
// que quedaron en `banks_movements` siguen con el id, y ése es un número que
// nadie fuera de la base puede resolver — peor: se lee como un folio que existe
// y es OTRO documento (la venta #243 es la MTZ-0239, y MTZ-0243 es la #247).
//
// Este script reescribe esas notas con el folio.
//
// Uso (desde kilker-inventario/):
//   npx tsx scripts/fix-note-folios.ts             (dry-run: solo imprime)
//   npx tsx scripts/fix-note-folios.ts --apply     (escribe)
//
// ⚠️ IDEMPOTENTE: solo toca notas donde el documento se nombra con `#<número>`.
// Una nota ya con folio no vuelve a entrar.
//
// ⚠️ Es un UPDATE del TEXTO, no del dinero. No se toca importe, fecha, tipo,
// cuenta ni liga: la nota es el rastro de lectura, y aquí se corrige a un
// identificador que dice lo mismo pero se puede seguir desde la pantalla. Lo
// que NO se hace es reescribir la razón que capturó una persona: si la nota
// trae un sufijo (`: motivo`), se conserva tal cual.
//
// ⚠️ Lo que NO se puede arreglar: una nota como "Anulación de entrada" a secas
// (sin id) no nombra ningún documento, y al haberse borrado el abono la liga ya
// está en NULL. No hay de dónde sacar el folio: se reporta y se deja.
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
 * "…de la venta #243…" → la preposición (si está), el sustantivo y el id.
 *
 * Se busca el patrón en CUALQUIER parte de la nota y no solo al principio: así
 * cubre las notas con motivo capturado ("…venta #243: cliente se arrepintió") y
 * cualquier plantilla futura que nombre el documento de esta forma.
 *
 * ⚠️ El `de` previo entra en la coincidencia a propósito, aunque no cambie de
 * documento: la plantilla vieja decía "de la gasto" (el defecto de género que se
 * arregló en paymentDeletion.ts), así que reemplazar solo "la gasto" por
 * "el gasto" dejaba "de el gasto". Con la preposición dentro se emite "del".
 */
const DOC_REF = /(de\s+)?(la|el)\s+(venta|entrada|gasto)\s+#(\d+)/i

type Kind = 'venta' | 'entrada' | 'gasto'

/** Cómo se nombra cada documento, con y sin la preposición delante. */
const ARTICLE: Record<Kind, { conDe: string; sinDe: string }> = {
  venta: { conDe: 'de la venta', sinDe: 'la venta' },
  entrada: { conDe: 'de la entrada', sinDe: 'la entrada' },
  gasto: { conDe: 'del gasto', sinDe: 'el gasto' }
}

/**
 * El identificador humano de cada documento, por id.
 *
 * Mismos textos que escriben hoy los endpoints: folio en ventas y entradas,
 * proveedor + número de factura en gastos.
 */
async function resolveRefs(kind: Kind, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map()
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  )

  const rows =
    kind === 'venta'
      ? await db.execute<{ id: number; ref: string | null }>(
          sql`SELECT id, folio AS ref FROM invoices WHERE id IN (${list})`
        )
      : kind === 'entrada'
        ? await db.execute<{ id: number; ref: string | null }>(
            sql`SELECT id, "Folio" AS ref FROM stock_movements WHERE id IN (${list})`
          )
        : await db.execute<{ id: number; ref: string | null }>(
            sql`SELECT id, supplier || coalesce(' ' || supplier_invoice_number, '') AS ref
                  FROM expenses WHERE id IN (${list})`
          )

  const byId = new Map<number, string>()
  for (const r of rows) {
    // Un documento sin folio capturado se queda como está: cambiarlo por otro
    // id no arregla nada. La entrada es el caso real ("Folio" es nullable).
    if (r.ref && r.ref.trim()) byId.set(Number(r.id), r.ref.trim())
  }
  return byId
}

async function main() {
  console.log(
    isApply
      ? '🔧 Modo APLICAR — se reescribirán las notas de banks_movements'
      : '🔍 Modo DRY-RUN — solo se muestra qué cambiaría (usa --apply para escribir)'
  )

  const candidatas = await db.execute<{ id: number; note: string }>(sql`
    SELECT id, note
      FROM banks_movements
     WHERE note ~* '(la|el)\\s+(venta|entrada|gasto)\\s+#[0-9]+'
     ORDER BY id
  `)

  // ⚠️ Sin salida anticipada cuando la clase 1 no encuentra nada: la clase 2
  // (abajo) es independiente y se quedaría sin correr. Ya pasó — con las notas
  // de `#id` ya corregidas, el script decía "todas nombran el documento por
  // folio" y se iba, dejando intacta la que no nombra ninguno.
  //
  // Los ids se agrupan por tipo para resolverlos en TRES consultas y no en una
  // por nota.
  const porTipo = new Map<Kind, Set<number>>()
  const parsed: Array<{ id: number; note: string; kind: Kind; docId: number }> = []
  for (const row of candidatas) {
    const m = DOC_REF.exec(row.note)
    if (!m) continue
    const kind = m[3]!.toLowerCase() as Kind
    const docId = Number(m[4])
    parsed.push({ id: row.id, note: row.note, kind, docId })
    if (!porTipo.has(kind)) porTipo.set(kind, new Set())
    porTipo.get(kind)!.add(docId)
  }

  const refs = new Map<Kind, Map<number, string>>()
  for (const [kind, ids] of porTipo) {
    refs.set(kind, await resolveRefs(kind, [...ids]))
  }

  const cambios: Array<{ id: number; antes: string; despues: string }> = []
  const sinFolio: Array<{ id: number; note: string }> = []

  for (const row of parsed) {
    const ref = refs.get(row.kind)?.get(row.docId)
    if (!ref) {
      sinFolio.push({ id: row.id, note: row.note })
      continue
    }
    // Se reemplaza SOLO el pedazo que nombra al documento: el artículo se
    // corrige de paso ("de la gasto #332" era otro defecto de la misma
    // plantilla) y todo lo demás de la nota —incluido el motivo que escribió
    // una persona— se queda intacto.
    const despues = row.note.replace(DOC_REF, (_full, de: string | undefined) =>
      `${de ? ARTICLE[row.kind].conDe : ARTICLE[row.kind].sinDe} ${ref}`
    )
    if (despues !== row.note) cambios.push({ id: row.id, antes: row.note, despues })
  }

  // ── Clase 2: la reversa que no nombra documento ──
  // Solo el default viejo, palabra por palabra (ver el encabezado).
  const vagas = await db.execute<{ id: number; folio: string | null }>(sql`
    SELECT r.id                                         AS id,
           substring(o.note from '^Pago entrada (.+)$') AS folio
      FROM banks_movements r
      JOIN banks_movements o ON o.id = r.reverses_id
     WHERE r.note = 'Anulación de entrada'
     ORDER BY r.id
  `)
  for (const v of vagas) {
    if (!v.folio?.trim()) {
      sinFolio.push({ id: v.id, note: 'Anulación de entrada' })
      continue
    }
    cambios.push({
      id: v.id,
      antes: 'Anulación de entrada',
      despues: `Anulación de la entrada ${v.folio.trim()}`
    })
  }
  cambios.sort((a, b) => a.id - b.id)

  if (!cambios.length) {
    console.log('\nNo hay nada que reescribir.')
  } else {
    console.log(`\n${cambios.length} notas a reescribir:`)
    for (const c of cambios) {
      console.log(`   · #${c.id}`)
      console.log(`       antes:   ${c.antes}`)
      console.log(`       después: ${c.despues}`)
    }
  }

  if (sinFolio.length) {
    console.log(
      `\n⚠️  ${sinFolio.length} notas nombran un documento SIN folio capturado ` +
        '(o que ya no existe). Se dejan con el id:'
    )
    for (const s of sinFolio) console.log(`   · #${s.id}: ${s.note}`)
  }

  if (!cambios.length) return

  if (!isApply) {
    console.log('\nDry-run completo. Corre con --apply para reescribir estas notas.')
    return
  }

  // Todo en UNA transacción: media corrección deja la mitad de las notas
  // nombrando documentos distintos con el mismo formato, que es peor que no
  // haber empezado.
  await db.transaction(async (tx) => {
    for (const c of cambios) {
      await tx.execute(
        sql`UPDATE banks_movements SET note = ${c.despues} WHERE id = ${c.id}`
      )
    }
  })

  console.log(`\n✅ Reescritas ${cambios.length} notas.`)
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
