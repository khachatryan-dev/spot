CREATE TYPE "public"."table_session_close_reason" AS ENUM('staff', 'paid', 'expired');--> statement-breakpoint
CREATE TYPE "public"."table_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "table_session_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"guest_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "table_session_members_identity" CHECK (NOT ("table_session_members"."user_id" IS NOT NULL AND "table_session_members"."guest_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "table_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" "table_session_status" DEFAULT 'open' NOT NULL,
	"opened_via_qr_token_id" uuid,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" "table_session_close_reason",
	"closed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "table_sessions_code_format" CHECK ("table_sessions"."code" ~ '^[A-Z0-9]{6}$'),
	CONSTRAINT "table_sessions_closed_consistency" CHECK (("table_sessions"."status" = 'open' AND "table_sessions"."closed_at" IS NULL) OR ("table_sessions"."status" = 'closed' AND "table_sessions"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "table_session_members" ADD CONSTRAINT "table_session_members_session_id_table_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."table_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_session_members" ADD CONSTRAINT "table_session_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_session_members" ADD CONSTRAINT "table_session_members_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_opened_via_qr_token_id_qr_tokens_id_fk" FOREIGN KEY ("opened_via_qr_token_id") REFERENCES "public"."qr_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_table_fk" FOREIGN KEY ("table_id","restaurant_id") REFERENCES "public"."tables"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "table_session_members_user_unique" ON "table_session_members" USING btree ("session_id","user_id") WHERE "table_session_members"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "table_session_members_guest_unique" ON "table_session_members" USING btree ("session_id","guest_id") WHERE "table_session_members"."guest_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "table_session_members_session_idx" ON "table_session_members" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "table_sessions_one_open_per_table" ON "table_sessions" USING btree ("table_id") WHERE "table_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "table_sessions_restaurant_status_idx" ON "table_sessions" USING btree ("restaurant_id","status");