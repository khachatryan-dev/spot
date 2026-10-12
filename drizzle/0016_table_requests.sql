CREATE TYPE "public"."table_request_status" AS ENUM('pending', 'acknowledged', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."table_request_type" AS ENUM('waiter', 'bill', 'water', 'assistance', 'other');--> statement-breakpoint
CREATE TABLE "table_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"table_session_id" uuid NOT NULL,
	"member_id" uuid,
	"type" "table_request_type" NOT NULL,
	"note" text,
	"status" "table_request_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "table_requests_note_length" CHECK ("table_requests"."note" IS NULL OR length("table_requests"."note") <= 200)
);
--> statement-breakpoint
ALTER TABLE "table_requests" ADD CONSTRAINT "table_requests_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_requests" ADD CONSTRAINT "table_requests_member_id_table_session_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."table_session_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_requests" ADD CONSTRAINT "table_requests_acknowledged_by_user_id_users_id_fk" FOREIGN KEY ("acknowledged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_requests" ADD CONSTRAINT "table_requests_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_requests" ADD CONSTRAINT "table_requests_table_fk" FOREIGN KEY ("table_id","restaurant_id") REFERENCES "public"."tables"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_requests" ADD CONSTRAINT "table_requests_session_fk" FOREIGN KEY ("table_session_id","restaurant_id") REFERENCES "public"."table_sessions"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "table_requests_one_open_per_type" ON "table_requests" USING btree ("table_session_id","type") WHERE "table_requests"."status" IN ('pending', 'acknowledged');--> statement-breakpoint
CREATE INDEX "table_requests_restaurant_status_idx" ON "table_requests" USING btree ("restaurant_id","status","created_at");