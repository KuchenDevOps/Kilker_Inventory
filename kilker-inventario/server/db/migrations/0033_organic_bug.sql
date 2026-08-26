CREATE TYPE "public"."cash_flow_type" AS ENUM('cobro_venta', 'pago_entrada', 'pago_gasto', 'saldo_inicial', 'prestamo', 'retiro', 'ajuste', 'anulacion');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bank_accounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"bank" text NOT NULL,
	"owner" text NOT NULL,
	"card_last4" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_identity_uniq" UNIQUE("bank","owner","card_last4"),
	CONSTRAINT "bank_accounts_card_last4_format" CHECK ("bank_accounts"."card_last4" IS NULL OR "bank_accounts"."card_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "banks_movements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "banks_movements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" "cash_flow_type" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"occurred_at" date NOT NULL,
	"account_id" bigint,
	"store_id" bigint,
	"sale_payment_id" bigint,
	"entry_payment_id" bigint,
	"expense_payment_id" bigint,
	"reverses_id" bigint,
	"method" "payment_method",
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banks_movements_sale_payment_uniq" UNIQUE("sale_payment_id"),
	CONSTRAINT "banks_movements_entry_payment_uniq" UNIQUE("entry_payment_id"),
	CONSTRAINT "banks_movements_expense_payment_uniq" UNIQUE("expense_payment_id"),
	CONSTRAINT "banks_movements_reverses_uniq" UNIQUE("reverses_id"),
	CONSTRAINT "banks_movements_one_source" CHECK ((CASE WHEN "banks_movements"."sale_payment_id" IS NULL THEN 0 ELSE 1 END
         + CASE WHEN "banks_movements"."entry_payment_id" IS NULL THEN 0 ELSE 1 END
         + CASE WHEN "banks_movements"."expense_payment_id" IS NULL THEN 0 ELSE 1 END) <= 1),
	CONSTRAINT "banks_movements_amount_sign" CHECK (CASE "banks_movements"."type"
            WHEN 'cobro_venta'  THEN "banks_movements"."amount" > 0
            WHEN 'pago_entrada' THEN "banks_movements"."amount" < 0
            WHEN 'pago_gasto'   THEN "banks_movements"."amount" < 0
            WHEN 'prestamo'     THEN "banks_movements"."amount" > 0
            WHEN 'retiro'       THEN "banks_movements"."amount" < 0
            ELSE "banks_movements"."amount" <> 0
          END),
	CONSTRAINT "banks_movements_reversal_typed" CHECK (("banks_movements"."type" = 'anulacion') = ("banks_movements"."reverses_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "banks_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry_payments" ADD COLUMN "account_id" bigint;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD COLUMN "account_id" bigint;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "iva" numeric(14, 2) GENERATED ALWAYS AS (round("amount" * 0.16, 2)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "total_to_pay" numeric(14, 2) GENERATED ALWAYS AS ("amount" + round("amount" * 0.16, 2) - coalesce("retention_iva", 0) - coalesce("retention_isr", 0)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "account_id" bigint;--> statement-breakpoint
ALTER TABLE "banks_movements" ADD CONSTRAINT "banks_movements_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banks_movements" ADD CONSTRAINT "banks_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banks_movements" ADD CONSTRAINT "banks_movements_sale_payment_id_sale_payments_id_fk" FOREIGN KEY ("sale_payment_id") REFERENCES "public"."sale_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banks_movements" ADD CONSTRAINT "banks_movements_entry_payment_id_entry_payments_id_fk" FOREIGN KEY ("entry_payment_id") REFERENCES "public"."entry_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banks_movements" ADD CONSTRAINT "banks_movements_expense_payment_id_expense_payments_id_fk" FOREIGN KEY ("expense_payment_id") REFERENCES "public"."expense_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banks_movements" ADD CONSTRAINT "banks_movements_reverses_id_banks_movements_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."banks_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banks_movements" ADD CONSTRAINT "banks_movements_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "banks_movements_account_occurred_idx" ON "banks_movements" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "banks_movements_occurred_idx" ON "banks_movements" USING btree ("occurred_at");--> statement-breakpoint
ALTER TABLE "entry_payments" ADD CONSTRAINT "entry_payments_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_retentions_within_total" CHECK (coalesce("expenses"."retention_iva", 0) + coalesce("expenses"."retention_isr", 0)
          <= "expenses"."amount" + round("expenses"."amount" * 0.16, 2));