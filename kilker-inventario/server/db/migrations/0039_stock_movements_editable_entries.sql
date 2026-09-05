CREATE OR REPLACE FUNCTION "forbid_update_delete"()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'stock_movements es un libro append-only: DELETE no permitido. Use un movimiento de anulacion (reversa).';
  END IF;

  IF OLD."type" <> 'entrada' THEN
    RAISE EXCEPTION
      'stock_movements es un libro append-only: solo los movimientos de tipo entrada admiten correccion. Use un movimiento de anulacion (reversa).';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."product_id" IS DISTINCT FROM OLD."product_id"
     OR NEW."store_id" IS DISTINCT FROM OLD."store_id"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."quantity" IS DISTINCT FROM OLD."quantity"
     OR NEW."invoice_id" IS DISTINCT FROM OLD."invoice_id"
     OR NEW."transfer_id" IS DISTINCT FROM OLD."transfer_id"
     OR NEW."reverses_movement_id" IS DISTINCT FROM OLD."reverses_movement_id"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."Folio" IS DISTINCT FROM OLD."Folio"
     OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION
      'stock_movements: solo unit_value, total_value, supplier_invoice_number y supplier_invoice_date son corregibles en una entrada.';
  END IF;

  IF abs(NEW."total_value" - NEW."unit_value" * NEW."quantity") > 0.000001 THEN
    RAISE EXCEPTION
      'stock_movements: total_value debe ser unit_value * quantity (%).', NEW."unit_value" * NEW."quantity";
  END IF;

  RETURN NEW;
END;
$$;
