CREATE TYPE "public"."bill_status" AS ENUM('open', 'finalized', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "bill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"order_item_id" uuid,
	"member_id" uuid,
	"name" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"modifiers_total_minor" integer DEFAULT 0 NOT NULL,
	"quantity" smallint NOT NULL,
	"line_total_minor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_items_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "bill_items_quantity" CHECK ("bill_items"."quantity" BETWEEN 1 AND 50),
	CONSTRAINT "bill_items_prices" CHECK ("bill_items"."unit_price_minor" >= 0 AND "bill_items"."modifiers_total_minor" >= 0),
	CONSTRAINT "bill_items_line_total" CHECK ("bill_items"."line_total_minor" = ("bill_items"."unit_price_minor" + "bill_items"."modifiers_total_minor") * "bill_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"table_session_id" uuid NOT NULL,
	"status" "bill_status" DEFAULT 'open' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"service_fee_bps" smallint DEFAULT 0 NOT NULL,
	"service_fee_minor" integer DEFAULT 0 NOT NULL,
	"tax_included_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"paid_minor" integer DEFAULT 0 NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by_user_id" uuid,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bills_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "bills_currency_format" CHECK ("bills"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "bills_amounts" CHECK ("bills"."subtotal_minor" >= 0 AND "bills"."discount_minor" >= 0 AND "bills"."discount_minor" <= "bills"."subtotal_minor"
        AND "bills"."service_fee_minor" >= 0 AND "bills"."tax_included_minor" >= 0 AND "bills"."tax_included_minor" <= "bills"."total_minor"),
	CONSTRAINT "bills_total" CHECK ("bills"."total_minor" = "bills"."subtotal_minor" - "bills"."discount_minor" + "bills"."service_fee_minor"),
	CONSTRAINT "bills_service_fee_rate" CHECK ("bills"."service_fee_bps" BETWEEN 0 AND 3000),
	CONSTRAINT "bills_paid_range" CHECK ("bills"."paid_minor" >= 0 AND "bills"."paid_minor" <= "bills"."total_minor"),
	CONSTRAINT "bills_paid_means_settled" CHECK ("bills"."status" <> 'paid' OR ("bills"."paid_minor" = "bills"."total_minor" AND "bills"."paid_at" IS NOT NULL)),
	CONSTRAINT "bills_void_unpaid" CHECK ("bills"."status" <> 'void' OR ("bills"."paid_minor" = 0 AND "bills"."void_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_member_id_table_session_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."table_session_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_items" ADD CONSTRAINT "bill_items_bill_fk" FOREIGN KEY ("bill_id","restaurant_id") REFERENCES "public"."bills"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_finalized_by_user_id_users_id_fk" FOREIGN KEY ("finalized_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_location_fk" FOREIGN KEY ("location_id","restaurant_id") REFERENCES "public"."restaurant_locations"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_table_fk" FOREIGN KEY ("table_id","restaurant_id") REFERENCES "public"."tables"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_session_fk" FOREIGN KEY ("table_session_id","restaurant_id") REFERENCES "public"."table_sessions"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_items_order_item_unique" ON "bill_items" USING btree ("bill_id","order_item_id") WHERE "bill_items"."order_item_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bill_items_bill_idx" ON "bill_items" USING btree ("bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_one_per_session" ON "bills" USING btree ("table_session_id") WHERE "bills"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "bills_restaurant_status_idx" ON "bills" USING btree ("restaurant_id","status","created_at");--> statement-breakpoint
-- Hand-written (§22): bills are financial records. No deletes; once
-- finalized, amounts and lines are fixed and the bill can't reopen; on
-- finalizing, the lines must add up to the subtotal.
CREATE TRIGGER "bills_no_delete" BEFORE DELETE ON "bills" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE FUNCTION "bills_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
$$;--> statement-breakpoint
CREATE TRIGGER "bills_guard" BEFORE UPDATE ON "bills" FOR EACH ROW EXECUTE FUNCTION "bills_guard"();--> statement-breakpoint
CREATE FUNCTION "bill_items_only_while_open"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bill_state bill_status;
BEGIN
  SELECT status INTO bill_state FROM bills WHERE id = coalesce(NEW.bill_id, OLD.bill_id) FOR SHARE;
  IF bill_state IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'Lines of a % bill can''t change', bill_state;
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;--> statement-breakpoint
CREATE TRIGGER "bill_items_only_while_open" BEFORE INSERT OR UPDATE OR DELETE ON "bill_items" FOR EACH ROW EXECUTE FUNCTION "bill_items_only_while_open"();
