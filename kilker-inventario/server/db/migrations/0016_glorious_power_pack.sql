ALTER TABLE "transfers" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "canceled_by" uuid;--> statement-breakpoint
ALTER TABLE "transfers" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_canceled_by_profiles_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;