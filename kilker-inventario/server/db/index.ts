// ───────────────────────────────────────────────
//  CLIENTE DRIZZLE (runtime)
// ───────────────────────────────────────────────
// Pooler Supavisor (6543) con prepare:false para serverless. Ver CLAUDE.md §8.

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

  // prepare:false obligatorio con el pooler de transacciones de Supabase.
  const client = postgres(databaseUrl, { prepare: false })
  return drizzle(client, { schema })
}

// Singleton perezoso: una conexión por lambda, reutilizada entre invocaciones.
let _db: Db | undefined

/** Cliente Drizzle compartido. Usar dentro de rutas server/api/. */
export function useDb(): Db {
  if (!_db) _db = createDb()
  return _db
}

export { schema }
