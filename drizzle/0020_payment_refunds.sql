CREATE TYPE "public"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" text NOT NULL,
	"requested_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payment_refunds_amount_positive" CHECK ("payment_refunds"."amount_minor" > 0),
	CONSTRAINT "payment_refunds_reason_length" CHECK (length(trim("payment_refunds"."reason")) BETWEEN 3 AND 300)
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_refunds_payment_idx" ON "payment_refunds" USING btree ("payment_id");--> statement-breakpoint
-- Hand-written: refunds are financial records (§49.10).
CREATE TRIGGER "payment_refunds_no_delete" BEFORE DELETE ON "payment_refunds" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE FUNCTION "payment_refunds_lock_terms"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
    OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR (OLD.status <> 'pending' AND NEW.status IS DISTINCT FROM OLD.status)
  THEN
    RAISE EXCEPTION 'A refund''s amount and payment can''t change, nor a finished refund''s status';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payment_refunds_lock_terms" BEFORE UPDATE ON "payment_refunds" FOR EACH ROW EXECUTE FUNCTION "payment_refunds_lock_terms"();
