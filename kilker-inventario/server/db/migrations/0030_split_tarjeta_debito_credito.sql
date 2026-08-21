-- ─────────────────────────────────────────────────────────────────────────────
-- 'tarjeta' → 'debito' | 'credito'
--
-- Postgres no sabe QUITAR un valor de un enum, así que el tipo se recrea: las
-- 3 columnas bajan a text, se dropea el tipo, se crea el nuevo y se vuelven a
-- castear. ⚠️ El SQL que genera drizzle-kit NO incluye el UPDATE de abajo y
-- revienta al castear ('tarjeta' no existe en el tipo nuevo): las 19 facturas
-- históricas con tarjeta se reasignan a 'debito' (decisión del cliente, no se
-- sabía si eran de débito o de crédito). Se hace mientras la columna es text.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "entry_payments" ALTER COLUMN "method" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "entry_payments" ALTER COLUMN "method" SET DEFAULT 'efectivo'::text;--> statement-breakpoint
ALTER TABLE "expense_payments" ALTER COLUMN "method" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "expense_payments" ALTER COLUMN "method" SET DEFAULT 'efectivo'::text;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "payment_method" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "payment_method" SET DEFAULT 'efectivo'::text;--> statement-breakpoint

-- Reasignación de los datos históricos (solo `invoices` tiene filas 'tarjeta',
-- las otras dos van por si acaso: el enum es compartido).
UPDATE "invoices" SET "payment_method" = 'debito' WHERE "payment_method" = 'tarjeta';--> statement-breakpoint
UPDATE "expense_payments" SET "method" = 'debito' WHERE "method" = 'tarjeta';--> statement-breakpoint
UPDATE "entry_payments" SET "method" = 'debito' WHERE "method" = 'tarjeta';--> statement-breakpoint

DROP TYPE "public"."payment_method";--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('efectivo', 'debito', 'credito', 'transferencia');--> statement-breakpoint
ALTER TABLE "entry_payments" ALTER COLUMN "method" SET DEFAULT 'efectivo'::"public"."payment_method";--> statement-breakpoint
ALTER TABLE "entry_payments" ALTER COLUMN "method" SET DATA TYPE "public"."payment_method" USING "method"::"public"."payment_method";--> statement-breakpoint
ALTER TABLE "expense_payments" ALTER COLUMN "method" SET DEFAULT 'efectivo'::"public"."payment_method";--> statement-breakpoint
ALTER TABLE "expense_payments" ALTER COLUMN "method" SET DATA TYPE "public"."payment_method" USING "method"::"public"."payment_method";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "payment_method" SET DEFAULT 'efectivo'::"public"."payment_method";--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "payment_method" SET DATA TYPE "public"."payment_method" USING "payment_method"::"public"."payment_method";
