ALTER TABLE "invoice_items" ADD COLUMN "sample_product_id" bigint;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "sample_sku" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "sample_name" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sample_of_product_id" bigint;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_sample_product_id_products_id_fk" FOREIGN KEY ("sample_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sample_of_product_id_products_id_fk" FOREIGN KEY ("sample_of_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invoice_items_sample_product_id" ON "invoice_items" USING btree ("sample_product_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sample_of_uniq" UNIQUE("sample_of_product_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sample_price_zero" CHECK ("products"."sample_of_product_id" IS NULL OR "products"."price" = 0);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_sample_not_self" CHECK ("products"."sample_of_product_id" IS NULL OR "products"."sample_of_product_id" <> "products"."id");