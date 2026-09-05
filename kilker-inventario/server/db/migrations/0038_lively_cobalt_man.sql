CREATE TABLE "stock_movement_edits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stock_movement_edits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"movement_id" bigint NOT NULL,
	"prev_unit_value" numeric(18, 6) NOT NULL,
	"new_unit_value" numeric(18, 6) NOT NULL,
	"prev_supplier_invoice_number" text,
	"new_supplier_invoice_number" text,
	"prev_supplier_invoice_date" date,
	"new_supplier_invoice_date" date,
	"reason" text,
	"edited_by" uuid NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movement_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movement_edits" ADD CONSTRAINT "stock_movement_edits_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_edits" ADD CONSTRAINT "stock_movement_edits_edited_by_profiles_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movement_edits_movement_idx" ON "stock_movement_edits" USING btree ("movement_id","edited_at");