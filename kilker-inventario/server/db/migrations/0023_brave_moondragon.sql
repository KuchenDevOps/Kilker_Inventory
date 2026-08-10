CREATE TABLE "sales_kit_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_kit_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kit_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_kit_items_kit_product_unique" UNIQUE("kit_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "sales_kit_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales_kits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_kits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_kits_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
ALTER TABLE "sales_kits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_kit_items" ADD CONSTRAINT "sales_kit_items_kit_id_sales_kits_id_fk" FOREIGN KEY ("kit_id") REFERENCES "public"."sales_kits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_kit_items" ADD CONSTRAINT "sales_kit_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_kit_items_kit_id_idx" ON "sales_kit_items" USING btree ("kit_id");--> statement-breakpoint
CREATE INDEX "sales_kit_items_product_id_idx" ON "sales_kit_items" USING btree ("product_id");