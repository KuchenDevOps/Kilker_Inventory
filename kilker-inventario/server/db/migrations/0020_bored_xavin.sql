CREATE TYPE "public"."expense_type" AS ENUM('Fijo', 'Operativo');--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"expense_id" bigint NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "type" "expense_type" DEFAULT 'Operativo' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_expense_items_expense_id" ON "expense_items" USING btree ("expense_id");--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN "reason";