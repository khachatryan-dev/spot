ALTER TABLE "reviews" ADD COLUMN "reported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "reported_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "report_reason" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_reported_idx" ON "reviews" USING btree ("reported_at") WHERE "reviews"."reported_at" IS NOT NULL AND "reviews"."moderated_at" IS NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_report_reason" CHECK ("reviews"."reported_at" IS NULL OR length(trim("reviews"."report_reason")) BETWEEN 10 AND 500);