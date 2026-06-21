// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@pinia/nuxt', '@nuxtjs/supabase'],
  css: ['~/assets/css/main.css'],
  // @nuxtjs/supabase lee SUPABASE_URL, SUPABASE_KEY (anon/publishable) y
  // SUPABASE_SERVICE_KEY (solo servidor, para serverSupabaseServiceRole) del .env.
  // redirect:false a propósito: el middleware de redirección de @nuxtjs/supabase
  // depende del path por cookie, que NO resuelve la sesión en este setup (ver
  // memoria del proyecto). La protección de rutas se hace con un guard propio
  // solo-cliente en app/middleware/auth.global.ts (sesión por Bearer del cliente).
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
