CREATE TYPE "public"."purchase_order_status" AS ENUM('pendiente', 'aprobado', 'rechazado');--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(18, 2) GENERATED ALWAYS AS (round("quantity" * "unit_price", 2)) STORED NOT NULL,
	CONSTRAINT "purchase_order_items_quantity_pos" CHECK ("purchase_order_items"."quantity" > 0),
	CONSTRAINT "purchase_order_items_unit_price_nonneg" CHECK ("purchase_order_items"."unit_price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_orders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_contact" text,
	"note" text,
	"status" "purchase_order_status" DEFAULT 'pendiente' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_items_order_idx" ON "purchase_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_store_created_idx" ON "purchase_orders" USING btree ("store_id","created_at");