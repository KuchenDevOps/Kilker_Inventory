ALTER TABLE "expenses" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (sequence name "expenses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "store_id" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "paid_at" date NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "created_by" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_store_paid_idx" ON "expenses" USING btree ("store_id","paid_at");