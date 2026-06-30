// ───────────────────────────────────────────────
//  CLIENTE ADMIN DE SUPABASE (solo servidor)
// ───────────────────────────────────────────────
// Usa la service_role key para administrar usuarios de Auth (crear, cambiar
// contraseña, borrar). NUNCA exponer al cliente.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null = null

export function useSupabaseAdmin(): SupabaseClient {
  if (cached) return cached
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Supabase admin no está configurado (SUPABASE_URL / SUPABASE_SERVICE_KEY)'
    })
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  return cached
}
