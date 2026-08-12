CREATE TABLE "entry_payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"movement_id" bigint NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_by" text DEFAULT 'Sin especificar' NOT NULL,
	"paid_at" date NOT NULL,
	"method" "payment_method" DEFAULT 'efectivo' NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entry_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry_payments" ADD CONSTRAINT "entry_payments_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_payments" ADD CONSTRAINT "entry_payments_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entry_payments_movement_idx" ON "entry_payments" USING btree ("movement_id","paid_at");