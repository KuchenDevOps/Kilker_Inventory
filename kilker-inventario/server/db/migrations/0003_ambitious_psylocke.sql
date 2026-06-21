CREATE TYPE "public"."payment_method" AS ENUM('efectivo', 'tarjeta');--> statement-breakpoint
CREATE TABLE "cash_closeouts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cash_closeouts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"period_from" timestamp with time zone,
	"period_to" timestamp with time zone NOT NULL,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"total_emitido" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_efectivo" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_tarjeta" numeric(14, 2) DEFAULT '0' NOT NULL,
	"voided_count" integer DEFAULT 0 NOT NULL,
	"total_voided" numeric(14, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_closeouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_method" "payment_method" DEFAULT 'efectivo' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_closeouts" ADD CONSTRAINT "cash_closeouts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_closeouts" ADD CONSTRAINT "cash_closeouts_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_closeouts_store_created_idx" ON "cash_closeouts" USING btree ("store_id","created_at");