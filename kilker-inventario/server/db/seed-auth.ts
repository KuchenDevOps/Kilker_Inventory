// ───────────────────────────────────────────────
//  SEED DE AUTH (solo desarrollo)
// ───────────────────────────────────────────────
// Crea usuarios de prueba en Supabase Auth + sus profiles (idempotente).
// Requiere catálogo sembrado. Ejecutar: npm run db:seed:auth. Cambiar password en prod.

import 'dotenv/config'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { profiles, stores } from './schema'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const DB_URL = process.env.DIRECT_URL
if (!SUPABASE_URL || !SERVICE_KEY || !DB_URL) {
  throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY / DIRECT_URL en .env')
}

const PASSWORD = 'Kilker2025+'

const usersSeed: {
  email: string
  fullName: string
  role: 'admin' | 'empleado'
  storeCode: string | null
}[] = [
  { email: 'admin@kilker.mx', fullName: 'Administrador Kilker', role: 'admin', storeCode: null },
  { email: 'empleado@kilker.mx', fullName: 'Empleado Matriz', role: 'empleado', storeCode: 'MTZ' }
]

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})
const client = postgres(DB_URL, { max: 1 })
const db = drizzle(client, { schema })

/** Devuelve el id del usuario si existe en Auth, o null. */
async function findUserId(email: string): Promise<string | null> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) throw error
  const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase())
  return u?.id ?? null
}

/** Crea el usuario si no existe (email ya confirmado) y devuelve su id. */
async function ensureUser(email: string): Promise<string> {
  const existing = await findUserId(email)
  if (existing) return existing
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true
  })
  if (error) throw error
  if (!data.user) throw new Error(`createUser no devolvió usuario para ${email}`)
  return data.user.id
}

async function main() {
  const storeRows = await db.select({ id: stores.id, code: stores.code }).from(stores)
  const storeId = new Map(storeRows.map((s) => [s.code, s.id]))

  for (const u of usersSeed) {
    const id = await ensureUser(u.email)

    let sid: number | null = null
    if (u.storeCode) {
      sid = storeId.get(u.storeCode) ?? null
      if (sid == null) {
        throw new Error(`Tienda "${u.storeCode}" no existe. Corre primero \`npm run db:seed\`.`)
      }
    }

    await db
      .insert(profiles)
      .values({ id, fullName: u.fullName, role: u.role, storeId: sid, isActive: true })
      .onConflictDoUpdate({
        target: profiles.id,
        set: { fullName: u.fullName, role: u.role, storeId: sid, isActive: true }
      })

    console.log(
      `Usuario OK: ${u.email} (${u.role}${u.storeCode ? ' @ ' + u.storeCode : ' / global'}) id=${id}`
    )
  }

  console.log('Seed de auth completado. Contraseña temporal:', PASSWORD)
}

main()
  .then(async () => {
    await client.end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('Seed auth FALLÓ:', err)
    await client.end()
    process.exit(1)
  })
