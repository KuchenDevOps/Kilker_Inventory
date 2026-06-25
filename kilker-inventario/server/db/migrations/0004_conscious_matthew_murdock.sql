ALTER TYPE "public"."payment_method" ADD VALUE 'transferencia';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "max_quantity" numeric(14, 3);