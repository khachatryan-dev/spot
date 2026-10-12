CREATE TYPE "public"."reservation_status" AS ENUM('pending_payment', 'pending_confirmation', 'confirmed', 'arrived', 'seated', 'completed', 'cancelled', 'no_show', 'expired');--> statement-breakpoint
CREATE TYPE "public"."reservation_confirmation_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TABLE "reservation_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"reservation_id" uuid,
	"created_by_user_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_holds_time_order" CHECK ("reservation_holds"."ends_at" > "reservation_holds"."starts_at"),
	CONSTRAINT "reservation_holds_note_length" CHECK ("reservation_holds"."note" IS NULL OR length("reservation_holds"."note") <= 200)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"customer_user_id" uuid,
	"party_size" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "reservation_status" NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"note" text,
	"confirmed_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"seated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"no_show_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "reservations_time_order" CHECK ("reservations"."ends_at" > "reservations"."starts_at"),
	CONSTRAINT "reservations_party_size" CHECK ("reservations"."party_size" BETWEEN 1 AND 50),
	CONSTRAINT "reservations_contact_name" CHECK (length(trim("reservations"."contact_name")) BETWEEN 1 AND 100),
	CONSTRAINT "reservations_contact_phone" CHECK ("reservations"."contact_phone" ~ '^\+?[0-9]{6,15}$'),
	CONSTRAINT "reservations_note_length" CHECK ("reservations"."note" IS NULL OR length("reservations"."note") <= 500),
	CONSTRAINT "reservations_cancellation_reason_length" CHECK ("reservations"."cancellation_reason" IS NULL OR length("reservations"."cancellation_reason") <= 300)
);
--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD COLUMN "reservation_confirmation" "reservation_confirmation_mode" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD COLUMN "reservation_duration_minutes" smallint DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD COLUMN "reservation_min_notice_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD COLUMN "reservation_max_days_ahead" smallint DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_id_location_unique" UNIQUE("id","location_id");--> statement-breakpoint
ALTER TABLE "reservation_holds" ADD CONSTRAINT "reservation_holds_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_holds" ADD CONSTRAINT "reservation_holds_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_holds" ADD CONSTRAINT "reservation_holds_table_fk" FOREIGN KEY ("table_id","restaurant_id") REFERENCES "public"."tables"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_holds" ADD CONSTRAINT "reservation_holds_reservation_fk" FOREIGN KEY ("reservation_id","restaurant_id") REFERENCES "public"."reservations"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_location_fk" FOREIGN KEY ("location_id","restaurant_id") REFERENCES "public"."restaurant_locations"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_restaurant_fk" FOREIGN KEY ("table_id","restaurant_id") REFERENCES "public"."tables"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_location_fk" FOREIGN KEY ("table_id","location_id") REFERENCES "public"."tables"("id","location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_holds_one_live_per_reservation" ON "reservation_holds" USING btree ("reservation_id") WHERE "reservation_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX "reservation_holds_table_idx" ON "reservation_holds" USING btree ("table_id","starts_at");--> statement-breakpoint
CREATE INDEX "reservation_holds_expiry_idx" ON "reservation_holds" USING btree ("expires_at") WHERE "reservation_holds"."released_at" IS NULL AND "reservation_holds"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reservations_location_starts_idx" ON "reservations" USING btree ("location_id","starts_at");--> statement-breakpoint
CREATE INDEX "reservations_customer_starts_idx" ON "reservations" USING btree ("customer_user_id","starts_at");--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_reservation_settings" CHECK (reservation_duration_minutes BETWEEN 30 AND 360 AND reservation_min_notice_minutes BETWEEN 0 AND 10080 AND reservation_max_days_ahead BETWEEN 1 AND 365);--> statement-breakpoint
-- Hand-written (drizzle can't express exclusion constraints): no two live
-- holds may claim the same table for overlapping times (§49.7).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "reservation_holds" ADD CONSTRAINT "reservation_holds_no_overlap" EXCLUDE USING gist ("table_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("released_at" IS NULL);
