// ───────────────────────────────────────────────
//  AUTH DE SERVIDOR
// ───────────────────────────────────────────────
// Resuelve el perfil del usuario por cookie o Bearer; verifica rol y actividad.
//
// ⚠️ COSTO: verificar un Bearer implica un round-trip HTTP a Supabase Auth
// (`/auth/v1/user`) + una query a `profiles`. Una página que dispara N
// peticiones autenticadas generaba N verificaciones. Para evitarlo hay dos
// niveles de caché:
//
//   1. Por request (`event.context`): un handler que llame `requireProfile`
//      varias veces resuelve una sola vez.
//   2. Por token, a nivel de módulo, con TTL corto: todas las peticiones de
//      una misma carga de página comparten una sola verificación.
//
// ⚠️ Consecuencia del nivel 2: desactivar un usuario (`is_active = false`) o
// cambiarle el rol tarda hasta PROFILE_CACHE_TTL_MS en surtir efecto. Es un
// trade-off deliberado; bajar el TTL si el negocio necesita revocación más
// inmediata. El caché es por proceso: en Vercel cada instancia tiene el suyo.
import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { eq } from 'drizzle-orm'
import { serverSupabaseUser } from '#supabase/server'
import { useDb } from '../db'
import { profiles } from '../db/schema'

export type SessionProfile = typeof profiles.$inferSelect

const PROFILE_CACHE_TTL_MS = 60_000
/** Tope de entradas: evita crecimiento sin límite en procesos de larga vida. */
const PROFILE_CACHE_MAX_ENTRIES = 500

const profileCache = new Map<string, { profile: SessionProfile; expiresAt: number }>()

/** Cliente único para verificar tokens: antes se creaba uno por petición. */
let authClient: SupabaseClient | null = null
function getAuthClient(): SupabaseClient | null {
  if (authClient) return authClient
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_KEY
  if (!url || !key) return null
  authClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  return authClient
}

/** No guardamos el JWT crudo como llave del caché. */
function cacheKeyForToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function readCache(key: string): SessionProfile | null {
  const hit = profileCache.get(key)
  if (!hit) return null
  if (hit.expiresAt < Date.now()) {
    profileCache.delete(key)
    return null
  }
  return hit.profile
}

function writeCache(key: string, profile: SessionProfile) {
  if (profileCache.size >= PROFILE_CACHE_MAX_ENTRIES) {
    const now = Date.now()
    for (const [k, v] of profileCache) if (v.expiresAt < now) profileCache.delete(k)
    // Si tras purgar los expirados sigue lleno, tiramos el más antiguo insertado.
    if (profileCache.size >= PROFILE_CACHE_MAX_ENTRIES) {
      const oldest = profileCache.keys().next()
      if (!oldest.done) profileCache.delete(oldest.value)
    }
  }
  profileCache.set(key, { profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS })
}

/**
 * Invalida el perfil cacheado de un usuario. Llamar tras desactivar un
 * usuario o cambiarle el rol/sucursal, para que el cambio aplique de
 * inmediato en este proceso en vez de esperar al TTL.
 */
export function invalidateProfileCache(userId?: string) {
  if (!userId) {
    profileCache.clear()
    return
  }
  for (const [key, value] of profileCache) {
    if (value.profile.id === userId) profileCache.delete(key)
  }
}

async function loadProfile(userId: string): Promise<SessionProfile | null> {
  const db = useDb()
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, userId) })
  if (!profile || !profile.isActive) return null
  return profile
}

/**
 * `userId: null` = no hay sesión válida (→ 401).
 * `userId` presente con `profile: null` = sesión válida pero perfil
 * inexistente o inactivo (→ 403). Distinguirlos preserva los códigos de
 * error que ya consumía el cliente.
 */
type Resolved = { userId: string | null; profile: SessionProfile | null }

/**
 * Resuelve el perfil autenticado (Bearer o cookie), con caché por request y
 * por token.
 */
async function resolveProfile(event: H3Event): Promise<Resolved> {
  // ── Nivel 1: caché por request ──
  if (event.context.__auth) return event.context.__auth as Resolved

  const remember = (resolved: Resolved) => {
    event.context.__auth = resolved
    return resolved
  }

  const authHeader = getHeader(event, 'authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length)
    const key = cacheKeyForToken(token)

    // ── Nivel 2: caché por token ──
    const cached = readCache(key)
    if (cached) return remember({ userId: cached.id, profile: cached })

    const sb = getAuthClient()
    if (!sb) return remember({ userId: null, profile: null })

    const { data, error } = await sb.auth.getUser(token)
    if (error || !data.user) return remember({ userId: null, profile: null })

    const profile = await loadProfile(data.user.id)
    // Solo se cachean perfiles válidos: un perfil inactivo debe re-verificarse.
    if (profile) writeCache(key, profile)
    return remember({ userId: data.user.id, profile })
  }

  // Navegador: sesión por cookie gestionada por @nuxtjs/supabase.
  // Sin token que usar como llave, aquí solo aplica el caché por request.
  const user = await serverSupabaseUser(event)
  if (!user?.id) return remember({ userId: null, profile: null })
  return remember({ userId: user.id, profile: await loadProfile(user.id) })
}

/** Devuelve el perfil autenticado o null (sin lanzar). Para /api/me. */
export async function getOptionalProfile(
  event: H3Event
): Promise<SessionProfile | null> {
  const { profile } = await resolveProfile(event)
  return profile
}

export async function requireProfile(
  event: H3Event,
  opts: { role?: 'admin' | 'empleado' } = {}
): Promise<SessionProfile> {
  const { userId, profile } = await resolveProfile(event)

  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'No autenticado' })
  }
  if (!profile) {
    throw createError({ statusCode: 403, statusMessage: 'Perfil inactivo o inexistente' })
  }
  if (opts.role && profile.role !== opts.role) {
    throw createError({ statusCode: 403, statusMessage: `Requiere rol ${opts.role}` })
  }
  return profile
}
