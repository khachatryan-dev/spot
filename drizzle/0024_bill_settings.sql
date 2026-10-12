ALTER TABLE "bills" ADD COLUMN "vat_rate_bps" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD COLUMN "service_fee_bps" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "vat_rate_bps" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_service_fee" CHECK (service_fee_bps BETWEEN 0 AND 3000);--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_vat_rate" CHECK ("restaurants"."vat_rate_bps" BETWEEN 0 AND 5000);--> statement-breakpoint
-- Hand-written: the VAT rate is locked with the other amounts once finalized.
CREATE OR REPLACE FUNCTION "bills_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lines_total integer;
BEGIN
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.table_session_id IS DISTINCT FROM OLD.table_session_id
    OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'A bill''s restaurant, visit and currency can''t change';
  END IF;
  IF OLD.status <> 'open' THEN
    IF NEW.status = 'open' THEN
      RAISE EXCEPTION 'A finalized bill can''t be reopened';
    END IF;
    IF OLD.status IN ('paid', 'void') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'A % bill is final', OLD.status;
    END IF;
    IF NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
      OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor
      OR NEW.service_fee_bps IS DISTINCT FROM OLD.service_fee_bps
      OR NEW.service_fee_minor IS DISTINCT FROM OLD.service_fee_minor
      OR NEW.tax_included_minor IS DISTINCT FROM OLD.tax_included_minor
      OR NEW.vat_rate_bps IS DISTINCT FROM OLD.vat_rate_bps
      OR NEW.total_minor IS DISTINCT FROM OLD.total_minor THEN
      RAISE EXCEPTION 'A finalized bill''s amounts can''t change';
    END IF;
  ELSIF NEW.status = 'paid' THEN
    RAISE EXCEPTION 'A bill must be finalized before it is paid';
  ELSIF NEW.status = 'finalized' THEN
    SELECT coalesce(sum(line_total_minor), 0) INTO lines_total FROM bill_items WHERE bill_id = NEW.id;
    IF lines_total <> NEW.subtotal_minor THEN
      RAISE EXCEPTION 'Bill lines add up to %, not the subtotal %', lines_total, NEW.subtotal_minor;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
