CREATE TYPE "public"."reservation_deposit_type" AS ENUM('none', 'per_guest', 'per_booking');--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "deposit_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD COLUMN "reservation_deposit_type" "reservation_deposit_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD COLUMN "reservation_deposit_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD COLUMN "reservation_refund_cutoff_hours" smallint DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_deposit" CHECK ("reservations"."deposit_minor" >= 0);--> statement-breakpoint
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_deposit" CHECK ((reservation_deposit_type = 'none' OR reservation_deposit_minor > 0) AND reservation_deposit_minor BETWEEN 0 AND 100000000 AND reservation_refund_cutoff_hours BETWEEN 0 AND 168);