CREATE TYPE "public"."review_status" AS ENUM('pending', 'published', 'hidden', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."review_subject" AS ENUM('reservation', 'visit');--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"subject" "review_subject" NOT NULL,
	"reservation_id" uuid,
	"table_session_id" uuid,
	"author_user_id" uuid,
	"author_guest_id" uuid,
	"author_email" text,
	"display_name" text NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"status" "review_status" DEFAULT 'published' NOT NULL,
	"published_at" timestamp with time zone,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_reason" text,
	"response" text,
	"responded_at" timestamp with time zone,
	"responded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_rating" CHECK ("reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "reviews_comment_length" CHECK ("reviews"."comment" IS NULL OR length("reviews"."comment") <= 2000),
	CONSTRAINT "reviews_subject_target" CHECK (("reviews"."subject" = 'reservation' AND "reviews"."reservation_id" IS NOT NULL AND "reviews"."table_session_id" IS NULL)
        OR ("reviews"."subject" = 'visit' AND "reviews"."table_session_id" IS NOT NULL AND "reviews"."reservation_id" IS NULL)),
	CONSTRAINT "reviews_author" CHECK (NOT ("reviews"."author_user_id" IS NOT NULL AND "reviews"."author_guest_id" IS NOT NULL)),
	CONSTRAINT "reviews_guest_email" CHECK ("reviews"."author_guest_id" IS NULL OR "reviews"."author_email" IS NOT NULL),
	CONSTRAINT "reviews_email_lowercase" CHECK ("reviews"."author_email" IS NULL OR "reviews"."author_email" = lower("reviews"."author_email")),
	CONSTRAINT "reviews_display_name" CHECK (length(trim("reviews"."display_name")) BETWEEN 1 AND 60),
	CONSTRAINT "reviews_response_length" CHECK ("reviews"."response" IS NULL OR length("reviews"."response") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_guest_id_guests_id_fk" FOREIGN KEY ("author_guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_responded_by_user_id_users_id_fk" FOREIGN KEY ("responded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_location_fk" FOREIGN KEY ("location_id","restaurant_id") REFERENCES "public"."restaurant_locations"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reservation_fk" FOREIGN KEY ("reservation_id","restaurant_id") REFERENCES "public"."reservations"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_session_fk" FOREIGN KEY ("table_session_id","restaurant_id") REFERENCES "public"."table_sessions"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_one_per_reservation" ON "reviews" USING btree ("reservation_id") WHERE "reviews"."reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_one_per_visit_user" ON "reviews" USING btree ("table_session_id","author_user_id") WHERE "reviews"."table_session_id" IS NOT NULL AND "reviews"."author_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_one_per_visit_guest" ON "reviews" USING btree ("table_session_id","author_guest_id") WHERE "reviews"."table_session_id" IS NOT NULL AND "reviews"."author_guest_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "reviews_restaurant_status_idx" ON "reviews" USING btree ("restaurant_id","status","created_at");