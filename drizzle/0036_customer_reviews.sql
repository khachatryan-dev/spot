CREATE TABLE "customer_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"subject" "review_subject" NOT NULL,
	"reservation_id" uuid,
	"table_session_id" uuid,
	"customer_user_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_reviews_rating" CHECK ("customer_reviews"."rating" BETWEEN 1 AND 5),
	CONSTRAINT "customer_reviews_comment_length" CHECK ("customer_reviews"."comment" IS NULL OR length("customer_reviews"."comment") <= 500),
	CONSTRAINT "customer_reviews_subject_target" CHECK (("customer_reviews"."subject" = 'reservation' AND "customer_reviews"."reservation_id" IS NOT NULL AND "customer_reviews"."table_session_id" IS NULL)
        OR ("customer_reviews"."subject" = 'visit' AND "customer_reviews"."table_session_id" IS NOT NULL AND "customer_reviews"."reservation_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_reservation_fk" FOREIGN KEY ("reservation_id","restaurant_id") REFERENCES "public"."reservations"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_reviews" ADD CONSTRAINT "customer_reviews_session_fk" FOREIGN KEY ("table_session_id","restaurant_id") REFERENCES "public"."table_sessions"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_reviews_one_per_reservation" ON "customer_reviews" USING btree ("reservation_id") WHERE "customer_reviews"."reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_reviews_one_per_visit_customer" ON "customer_reviews" USING btree ("table_session_id","customer_user_id") WHERE "customer_reviews"."table_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customer_reviews_restaurant_customer_idx" ON "customer_reviews" USING btree ("restaurant_id","customer_user_id");--> statement-breakpoint
CREATE INDEX "customer_reviews_customer_idx" ON "customer_reviews" USING btree ("customer_user_id","created_at");