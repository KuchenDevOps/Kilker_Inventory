// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@pinia/nuxt', '@nuxtjs/supabase'],
  css: ['~/assets/css/main.css'],
  // redirect:false: el path por cookie no resuelve aquí; guard propio en middleware.
  supabase: {
    redirect: false,
    // Tipos de BD off: la capa de datos es Drizzle, no generamos database.types.ts.
    types: false
  },
  runtimeConfig: {
    // Secreto solo-servidor: pooler Supabase (Supavisor 6543) vía DATABASE_URL.
    databaseUrl: process.env.DATABASE_URL
  },
  app: {
    head: {
      title: 'Inventario Kilker',
      htmlAttrs: { lang: 'es' },
      // Iconos de marca (public/): el .ico cubre navegadores viejos, los PNG el resto.
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }
      ],
      meta: [{ name: 'theme-color', content: '#0c325b' }]
    }
  }
})
