CREATE TYPE "public"."bill_payment_method" AS ENUM('online', 'cash', 'card_terminal');--> statement-breakpoint
CREATE TYPE "public"."bill_payment_mode" AS ENUM('equal', 'items', 'full');--> statement-breakpoint
CREATE TYPE "public"."bill_payment_status" AS ENUM('pending', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "bill_payment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"bill_payment_id" uuid NOT NULL,
	"bill_item_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bill_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"mode" "bill_payment_mode" NOT NULL,
	"share_index" smallint,
	"share_count" smallint,
	"amount_minor" integer NOT NULL,
	"method" "bill_payment_method" NOT NULL,
	"status" "bill_payment_status" NOT NULL,
	"payment_id" uuid,
	"member_id" uuid,
	"recorded_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bill_payments_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "bill_payments_amount_positive" CHECK ("bill_payments"."amount_minor" > 0),
	CONSTRAINT "bill_payments_share" CHECK (("bill_payments"."mode" = 'equal') = ("bill_payments"."share_index" IS NOT NULL AND "bill_payments"."share_count" IS NOT NULL)
        AND ("bill_payments"."share_count" IS NULL OR ("bill_payments"."share_count" BETWEEN 2 AND 20
          AND "bill_payments"."share_index" BETWEEN 1 AND "bill_payments"."share_count"))),
	CONSTRAINT "bill_payments_method" CHECK (("bill_payments"."method" = 'online' AND ("bill_payments"."payment_id" IS NOT NULL OR "bill_payments"."status" <> 'succeeded'))
        OR ("bill_payments"."method" <> 'online' AND "bill_payments"."payment_id" IS NULL AND "bill_payments"."recorded_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "bill_payment_items" ADD CONSTRAINT "bill_payment_items_payment_fk" FOREIGN KEY ("bill_payment_id","restaurant_id") REFERENCES "public"."bill_payments"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payment_items" ADD CONSTRAINT "bill_payment_items_item_fk" FOREIGN KEY ("bill_item_id","restaurant_id") REFERENCES "public"."bill_items"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_member_id_table_session_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."table_session_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_bill_fk" FOREIGN KEY ("bill_id","restaurant_id") REFERENCES "public"."bills"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_payment_items_one_live" ON "bill_payment_items" USING btree ("bill_item_id") WHERE "bill_payment_items"."active";--> statement-breakpoint
CREATE INDEX "bill_payment_items_payment_idx" ON "bill_payment_items" USING btree ("bill_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bill_payments_payment_unique" ON "bill_payments" USING btree ("payment_id") WHERE "bill_payments"."payment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "bill_payments_one_per_share" ON "bill_payments" USING btree ("bill_id","share_index") WHERE "bill_payments"."share_index" IS NOT NULL AND "bill_payments"."status" IN ('pending', 'succeeded');--> statement-breakpoint
CREATE INDEX "bill_payments_bill_idx" ON "bill_payments" USING btree ("bill_id");--> statement-breakpoint
-- Hand-written: bill payments are financial records (§22, §49.10).
CREATE TRIGGER "bill_payments_no_delete" BEFORE DELETE ON "bill_payments" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE TRIGGER "bill_payment_items_no_delete" BEFORE DELETE ON "bill_payment_items" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE FUNCTION "bill_payments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.bill_id IS DISTINCT FROM OLD.bill_id
    OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.share_index IS DISTINCT FROM OLD.share_index
    OR NEW.method IS DISTINCT FROM OLD.method THEN
    RAISE EXCEPTION 'A bill payment''s amount and what it covers can''t change';
  END IF;
  IF OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A % bill payment is final', OLD.status;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "bill_payments_guard" BEFORE UPDATE ON "bill_payments" FOR EACH ROW EXECUTE FUNCTION "bill_payments_guard"();
