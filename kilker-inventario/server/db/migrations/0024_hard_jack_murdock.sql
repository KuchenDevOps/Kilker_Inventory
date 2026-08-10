ALTER TABLE "invoice_items" ADD COLUMN "kit_id" bigint;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "kit_sku" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "kit_name" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "kit_quantity" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_kit_id_sales_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."sales_kits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoice_items_kit_id" ON "invoice_items" USING btree ("kit_id");