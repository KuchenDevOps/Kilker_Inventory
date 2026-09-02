ALTER TYPE "public"."cash_flow_type" ADD VALUE 'movimiento';--> statement-breakpoint
ALTER TABLE "banks_movements" ADD COLUMN "concept" text;--> statement-breakpoint
ALTER TABLE "banks_movements" ADD CONSTRAINT "banks_movements_concept_required" CHECK ("banks_movements"."type"::text <> 'movimiento' OR ("banks_movements"."concept" IS NOT NULL AND btrim("banks_movements"."concept") <> ''));