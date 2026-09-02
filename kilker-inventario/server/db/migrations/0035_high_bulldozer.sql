CREATE TYPE "public"."expense_status" AS ENUM('emitido', 'anulado');--> statement-breakpoint
ALTER TYPE "public"."ticket_target" ADD VALUE 'gasto';--> statement-breakpoint
DROP INDEX "banks_movements_occurred_idx";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "status" "expense_status" DEFAULT 'emitido' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "expense_id" bigint;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_voided_by_profiles_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;