CREATE TYPE "public"."table_status" AS ENUM('available', 'reserved', 'occupied', 'blocked', 'out_of_service');--> statement-breakpoint
CREATE TYPE "public"."table_type" AS ENUM('standard', 'bar', 'booth', 'outdoor', 'private');--> statement-breakpoint
CREATE TABLE "tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text,
	"capacity" smallint DEFAULT 4 NOT NULL,
	"zone" text,
	"type" "table_type" DEFAULT 'standard' NOT NULL,
	"status" "table_status" DEFAULT 'available' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tables_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "tables_capacity" CHECK ("tables"."capacity" BETWEEN 1 AND 50),
	CONSTRAINT "tables_number_not_blank" CHECK (length(trim("tables"."number")) BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "qr_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"last_scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_tokens_token_unique" UNIQUE("token"),
	CONSTRAINT "qr_tokens_token_format" CHECK ("qr_tokens"."token" ~ '^[A-Za-z0-9_-]{22,64}$')
);
--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_location_fk" FOREIGN KEY ("location_id","restaurant_id") REFERENCES "public"."restaurant_locations"("id","restaurant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_table_fk" FOREIGN KEY ("table_id","restaurant_id") REFERENCES "public"."tables"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tables_location_number_unique" ON "tables" USING btree ("location_id",lower(trim("number")));--> statement-breakpoint
CREATE INDEX "tables_location_idx" ON "tables" USING btree ("location_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_tokens_one_active_per_table" ON "qr_tokens" USING btree ("table_id") WHERE "qr_tokens"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "qr_tokens_table_idx" ON "qr_tokens" USING btree ("table_id");