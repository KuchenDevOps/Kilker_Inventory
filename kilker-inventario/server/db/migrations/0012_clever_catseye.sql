ALTER TABLE "invoices" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL;