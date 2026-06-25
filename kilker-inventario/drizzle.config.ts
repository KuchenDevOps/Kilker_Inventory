// ───────────────────────────────────────────────
//  CONFIG DRIZZLE-KIT (migraciones)
// ───────────────────────────────────────────────
// Usa DIRECT_URL (5432), no el pooler. schemaFilter 'public' protege auth.

// reference de tipos node: el archivo corre fuera de los tsconfig de Nuxt.
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
