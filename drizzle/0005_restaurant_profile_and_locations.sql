CREATE TYPE "public"."location_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "restaurant_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "location_status" DEFAULT 'active' NOT NULL,
	"address_line" text NOT NULL,
	"city" text NOT NULL,
	"country" text DEFAULT 'AM' NOT NULL,
	"postal_code" text,
	"latitude" double precision,
	"longitude" double precision,
	"phone" text,
	"timezone" text DEFAULT 'Asia/Yerevan' NOT NULL,
	"opening_hours" jsonb DEFAULT '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}'::jsonb NOT NULL,
	"reservations_enabled" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restaurant_locations_slug_format" CHECK ("restaurant_locations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "restaurant_locations_country_format" CHECK ("restaurant_locations"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "restaurant_locations_coordinates" CHECK (("restaurant_locations"."latitude" IS NULL AND "restaurant_locations"."longitude" IS NULL) OR ("restaurant_locations"."latitude" BETWEEN -90 AND 90 AND "restaurant_locations"."longitude" BETWEEN -180 AND 180))
);
--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "cuisines" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "price_range" smallint;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "currency" text DEFAULT 'AMD' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "cover_image_key" text;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restaurants" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_locations_restaurant_slug_unique" ON "restaurant_locations" USING btree ("restaurant_id","slug");--> statement-breakpoint
CREATE INDEX "restaurant_locations_restaurant_id_idx" ON "restaurant_locations" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "restaurants_status_idx" ON "restaurants" USING btree ("status");--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_slug_format" CHECK ("restaurants"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_price_range" CHECK ("restaurants"."price_range" IS NULL OR "restaurants"."price_range" BETWEEN 1 AND 4);--> statement-breakpoint
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_currency_format" CHECK ("restaurants"."currency" ~ '^[A-Z]{3}$');