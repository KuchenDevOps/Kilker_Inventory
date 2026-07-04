CREATE TABLE "entry_folio_counters" (
	"store_id" bigint PRIMARY KEY NOT NULL,
	"last_seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_folio_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "Folio" text;--> statement-breakpoint
ALTER TABLE "entry_folio_counters" ADD CONSTRAINT "entry_folio_counters_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_folio_unique" UNIQUE("store_id","Folio");