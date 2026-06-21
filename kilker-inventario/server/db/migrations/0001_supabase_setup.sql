-- Custom SQL migration file, put your code below! --

-- ─────────────────────────────────────────────────────────────────────────────
-- Migración manual — integración con Supabase + invariantes del modelo v1
--
-- Lo que NO puede expresar el schema.ts de Drizzle (o que rompería `generate`):
--   1. FK de `profiles.id` → `auth.users(id)` ON DELETE CASCADE.
--      `auth.users` lo gestiona Supabase Auth; no se modela en Drizzle porque
--      `drizzle-kit` intentaría crearla (la tabla ya existe en Supabase).
--   2. Inmutabilidad de `stock_movements` (libro append-only): trigger que
--      rechaza UPDATE/DELETE. Defensa en profundidad además de que `server/api`
--      solo hace INSERT. Las correcciones son filas nuevas (anulacion/reversa).
--
-- Pendiente (fase backend, requiere specs): folio secuencial por tienda en
-- `invoices.folio` (formato/serie sin confirmar — ver "Preguntas abiertas").
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. FK profiles → auth.users (Supabase Auth)
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_id_users_id_fk"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- 2. Inmutabilidad de stock_movements (append-only)
CREATE OR REPLACE FUNCTION "forbid_update_delete"()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'stock_movements es un libro append-only: % no permitido. Use un movimiento de anulacion (reversa).',
    TG_OP;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "stock_movements_forbid_update_delete"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "forbid_update_delete"();
