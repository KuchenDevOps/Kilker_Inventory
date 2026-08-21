-- ─────────────────────────────────────────────────────────────────────────────
-- El corte de caja separa débito y crédito
--
-- ⚠️ El UPDATE de en medio NO lo genera drizzle-kit: sin él, el DROP COLUMN se
-- lleva los $13,143.20 de los 3 cortes históricos que tenían importe en
-- total_tarjeta. Van íntegros a total_debito, igual que las facturas en la
-- migración 0030: antes no se distinguía el tipo de tarjeta, así que crédito
-- arranca en 0 para todo lo anterior.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "cash_closeouts" ADD COLUMN "total_debito" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_closeouts" ADD COLUMN "total_credito" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint

UPDATE "cash_closeouts" SET "total_debito" = "total_tarjeta" WHERE "total_tarjeta" <> 0;--> statement-breakpoint

ALTER TABLE "cash_closeouts" DROP COLUMN "total_tarjeta";
