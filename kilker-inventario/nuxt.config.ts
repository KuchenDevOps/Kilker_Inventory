// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@pinia/nuxt', '@nuxtjs/supabase'],
  css: ['~/assets/css/main.css'],
  // @nuxtjs/supabase lee SUPABASE_URL, SUPABASE_KEY (anon/publishable) y
  // SUPABASE_SERVICE_KEY (solo servidor, para serverSupabaseServiceRole) del .env.
  // redirect:false por ahora: aún no existe la página de login, así que no forzamos
  // el middleware de auth global (se activará al construir el login).
  supabase: {
    redirect: false,
    // La capa de datos es Drizzle; el cliente de Supabase solo se usa para auth.
    // Evita el warning de tipos de BD (database.types.ts) que no generamos.
    types: false
  },
  runtimeConfig: {
    // Secreto solo-servidor: cadena del pooler de Supabase (Supavisor 6543).
    // Valor real vía variable de entorno DATABASE_URL (.env / panel de Vercel).
    databaseUrl: process.env.DATABASE_URL
  },
  app: {
    head: {
      title: 'Inventario Kilker',
      htmlAttrs: { lang: 'es' }
    }
  }
})
