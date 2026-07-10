CREATE TABLE "expenses" (
	"id" bigint PRIMARY KEY NOT NULL,
	"supplier" text NOT NULL,
	"supplier_invoice_number" text NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;