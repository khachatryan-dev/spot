CREATE TYPE "public"."payment_purpose" AS ENUM('reservation_deposit', 'bill');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text,
	"type" text NOT NULL,
	"from_status" "payment_status",
	"to_status" "payment_status",
	"amount_minor" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"reservation_id" uuid,
	"customer_user_id" uuid,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text,
	"idempotency_key" text NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"succeeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_refunded_range" CHECK ("payments"."refunded_minor" >= 0 AND "payments"."refunded_minor" <= "payments"."amount_minor"),
	CONSTRAINT "payments_currency_format" CHECK ("payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payments_purpose_target" CHECK ("payments"."purpose" <> 'reservation_deposit' OR "payments"."reservation_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_fk" FOREIGN KEY ("reservation_id","restaurant_id") REFERENCES "public"."reservations"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_unique" ON "payment_events" USING btree ("provider","provider_event_id") WHERE "payment_events"."provider_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_unique" ON "payments" USING btree ("provider","provider_payment_id") WHERE "payments"."provider_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_restaurant_created_idx" ON "payments" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
-- Hand-written: payments are financial records (§49.10). No deletes; the
-- amount, currency, provider and target can't change; events are append-only.
CREATE TRIGGER "payments_no_delete" BEFORE DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE TRIGGER "payment_events_append_only" BEFORE UPDATE OR DELETE ON "payment_events" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE FUNCTION "payments_lock_terms"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
    OR (OLD.provider_payment_id IS NOT NULL AND NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id)
  THEN
    RAISE EXCEPTION 'A payment''s amount, currency, provider and target can''t change after it is created';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payments_lock_terms" BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION "payments_lock_terms"();
