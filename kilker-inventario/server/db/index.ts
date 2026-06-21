// ─────────────────────────────────────────────────────────────────────────────
// Cliente Drizzle (runtime) — Inventario Kilker
//
// Se conecta al Postgres de Supabase a través del POOLER de transacciones
// (Supavisor, puerto 6543) con `prepare: false`, requerido en entornos
// serverless (Vercel) para no agotar conexiones. La cadena vive en
// `runtimeConfig.databaseUrl` (solo servidor, nunca expuesta al cliente).
//
// Las migraciones usan en cambio la CONEXIÓN DIRECTA (5432) vía
// `drizzle.config.ts` (DIRECT_URL). Ver CLAUDE.md §8.
// ─────────────────────────────────────────────────────────────────────────────

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Db = ReturnType<typeof createDb>

function createDb() {
  const { databaseUrl } = useRuntimeConfig()

  if (!databaseUrl) {
    throw new Error(
      'Falta DATABASE_URL (pooler Supavisor 6543) en runtimeConfig. ' +
        'Configúrala en .env (local) o en las variables de entorno de Vercel.'
    )
  }

  // `prepare: false` es obligatorio con el pooler de transacciones de Supabase.
  const client = postgres(databaseUrl, { prepare: false })
  return drizzle(client, { schema })
}

// Singleton perezoso: una sola conexión por instancia (lambda) reutilizada
// entre invocaciones; no se conecta al importar el módulo.
let _db: Db | undefined

/** Cliente Drizzle compartido. Usar dentro de rutas `server/api/`. */
export function useDb(): Db {
  if (!_db) _db = createDb()
  return _db
}

export { schema }
