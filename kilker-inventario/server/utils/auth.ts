// Auth de servidor — Inventario Kilker.
//
// `requireProfile(event, { role })` identifica al usuario autenticado y devuelve su
// `profile` (con rol y tienda). Acepta dos vías:
//   - Cookie de sesión de @nuxtjs/supabase (navegador).
//   - Header `Authorization: Bearer <access_token>` (clientes API / pruebas).
// Lanza 401 si no hay sesión y 403 si el perfil está inactivo o no tiene el rol.
import type { H3Event } from 'h3'
import { createClient } from '@supabase/supabase-js'
import { eq } from 'drizzle-orm'
import { serverSupabaseUser } from '#supabase/server'
import { useDb } from '../db'
import { profiles } from '../db/schema'

export type SessionProfile = typeof profiles.$inferSelect

async function resolveUserId(event: H3Event): Promise<string | null> {
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length)
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_KEY
    if (!url || !key) return null
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data, error } = await sb.auth.getUser(token)
    if (error || !data.user) return null
    return data.user.id
  }
  // Navegador: sesión por cookie gestionada por @nuxtjs/supabase.
  const user = await serverSupabaseUser(event)
  return user?.id ?? null
}

/**
 * Devuelve el `profile` del usuario autenticado o `null` si no hay sesión válida
 * (sin lanzar). Útil para endpoints como `/api/me` que deben responder 200 + null
 * cuando no hay sesión, en vez de un 401.
 */
export async function getOptionalProfile(
  event: H3Event
): Promise<SessionProfile | null> {
  const userId = await resolveUserId(event)
  if (!userId) return null

  const db = useDb()
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, userId)
  })

  if (!profile || !profile.isActive) return null
  return profile
}

export async function requireProfile(
  event: H3Event,
  opts: { role?: 'admin' | 'empleado' } = {}
): Promise<SessionProfile> {
  const userId = await resolveUserId(event)
  if (!userId) {
    throw createError({ statusCode: 401, statusMessage: 'No autenticado' })
  }

  const db = useDb()
  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, userId)
  })

  if (!profile || !profile.isActive) {
    throw createError({ statusCode: 403, statusMessage: 'Perfil inactivo o inexistente' })
  }
  if (opts.role && profile.role !== opts.role) {
    throw createError({ statusCode: 403, statusMessage: `Requiere rol ${opts.role}` })
  }
  return profile
}
