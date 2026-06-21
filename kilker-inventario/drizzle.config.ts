// ─────────────────────────────────────────────────────────────────────────────
// Configuración de drizzle-kit — Inventario Kilker
//
// Usa la CONEXIÓN DIRECTA (DIRECT_URL, puerto 5432) para generar y aplicar
// migraciones — NO el pooler de transacciones (ese es solo para runtime).
// `schemaFilter: ['public']` evita que drizzle-kit toque el esquema `auth`
// gestionado por Supabase (donde vive `auth.users`).
// ─────────────────────────────────────────────────────────────────────────────

// `drizzle.config.ts` queda fuera de los tsconfig generados por Nuxt (.nuxt/*):
// es un archivo de herramienta que ejecuta drizzle-kit, no Nuxt. El editor lo
// abre como "proyecto inferido" sin @types/node, por lo que `process` daría
// "Cannot find name 'process'". Este directivo incluye los tipos de node de
// forma explícita y autocontenida (sobrevive a `nuxt prepare`).
/// <reference types="node" />
import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: {
    url: process.env.DIRECT_URL!
  },
  schemaFilter: ['public'],
  verbose: true,
  strict: true
})
