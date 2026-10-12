-- Hand-edited: unique key first (drizzle-kit ordered it after the FK that needs it); triggers at the end.
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_id_restaurant_unique" UNIQUE("id","restaurant_id");--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('submitted', 'received', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TABLE "order_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"modifier_id" uuid,
	"group_name" text NOT NULL,
	"name" text NOT NULL,
	"price_delta_minor" integer NOT NULL,
	CONSTRAINT "order_item_modifiers_price" CHECK ("order_item_modifiers"."price_delta_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"menu_item_id" uuid,
	"name" text NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"modifiers_total_minor" integer DEFAULT 0 NOT NULL,
	"quantity" smallint NOT NULL,
	"line_total_minor" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "order_items_quantity" CHECK ("order_items"."quantity" BETWEEN 1 AND 50),
	CONSTRAINT "order_items_prices" CHECK ("order_items"."unit_price_minor" >= 0 AND "order_items"."modifiers_total_minor" >= 0),
	CONSTRAINT "order_items_line_total" CHECK ("order_items"."line_total_minor" = ("order_items"."unit_price_minor" + "order_items"."modifiers_total_minor") * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "order_number_counters" (
	"restaurant_id" uuid PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"changed_by_user_id" uuid,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"table_session_id" uuid NOT NULL,
	"member_id" uuid,
	"number" integer NOT NULL,
	"status" "order_status" DEFAULT 'submitted' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "orders_amounts" CHECK ("orders"."subtotal_minor" >= 0 AND "orders"."discount_minor" >= 0 AND "orders"."discount_minor" <= "orders"."subtotal_minor"),
	CONSTRAINT "orders_total" CHECK ("orders"."total_minor" = "orders"."subtotal_minor" - "orders"."discount_minor"),
	CONSTRAINT "orders_number_positive" CHECK ("orders"."number" > 0),
	CONSTRAINT "orders_currency_format" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_idempotency_key" CHECK (length("orders"."idempotency_key") BETWEEN 8 AND 100)
);
--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifier_id_modifiers_id_fk" FOREIGN KEY ("modifier_id") REFERENCES "public"."modifiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_item_fk" FOREIGN KEY ("order_item_id","restaurant_id") REFERENCES "public"."order_items"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_fk" FOREIGN KEY ("order_id","restaurant_id") REFERENCES "public"."orders"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_number_counters" ADD CONSTRAINT "order_number_counters_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_fk" FOREIGN KEY ("order_id","restaurant_id") REFERENCES "public"."orders"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_member_id_table_session_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."table_session_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_fk" FOREIGN KEY ("location_id","restaurant_id") REFERENCES "public"."restaurant_locations"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_fk" FOREIGN KEY ("table_id","restaurant_id") REFERENCES "public"."tables"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_session_fk" FOREIGN KEY ("table_session_id","restaurant_id") REFERENCES "public"."table_sessions"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_item_modifiers_item_idx" ON "order_item_modifiers" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order_idx" ON "order_status_history" USING btree ("order_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_restaurant_number_unique" ON "orders" USING btree ("restaurant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_session_idempotency_unique" ON "orders" USING btree ("table_session_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_restaurant_status_idx" ON "orders" USING btree ("restaurant_id","status","submitted_at");--> statement-breakpoint
CREATE INDEX "orders_location_submitted_idx" ON "orders" USING btree ("location_id","submitted_at");--> statement-breakpoint
CREATE INDEX "orders_session_idx" ON "orders" USING btree ("table_session_id");--> statement-breakpoint
--> statement-breakpoint
-- Hand-written: financial records (§22, §49 #10) are never deleted, and what was ordered can't be edited.
CREATE FUNCTION "block_financial_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: financial records are immutable', TG_OP, TG_TABLE_NAME;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "orders_no_delete" BEFORE DELETE ON "orders" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE TRIGGER "order_items_immutable" BEFORE UPDATE OR DELETE ON "order_items" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE TRIGGER "order_item_modifiers_immutable" BEFORE UPDATE OR DELETE ON "order_item_modifiers" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
CREATE TRIGGER "order_status_history_append_only" BEFORE UPDATE OR DELETE ON "order_status_history" FOR EACH ROW EXECUTE FUNCTION "block_financial_change"();--> statement-breakpoint
-- Status and timestamps may change; amounts, currency and identity may not.
CREATE FUNCTION "orders_lock_amounts"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.subtotal_minor <> OLD.subtotal_minor OR NEW.discount_minor <> OLD.discount_minor
     OR NEW.total_minor <> OLD.total_minor OR NEW.currency <> OLD.currency
     OR NEW.restaurant_id <> OLD.restaurant_id OR NEW.number <> OLD.number
     OR NEW.table_session_id <> OLD.table_session_id THEN
    RAISE EXCEPTION 'An order''s amounts, currency, number and session can''t change after it is placed';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "orders_lock_amounts" BEFORE UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION "orders_lock_amounts"();
