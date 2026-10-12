CREATE TYPE "public"."pos_connection_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."pos_outbox_kind" AS ENUM('order_created', 'order_updated', 'bill_closed');--> statement-breakpoint
CREATE TYPE "public"."pos_outbox_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "pos_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" "pos_connection_status" DEFAULT 'active' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"delivery_lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_external_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"local_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pos_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" "pos_outbox_kind" NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "pos_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pos_connections" ADD CONSTRAINT "pos_connections_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_connections" ADD CONSTRAINT "pos_connections_location_fk" FOREIGN KEY ("location_id","restaurant_id") REFERENCES "public"."restaurant_locations"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_external_refs" ADD CONSTRAINT "pos_external_refs_connection_id_pos_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pos_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_outbox" ADD CONSTRAINT "pos_outbox_connection_id_pos_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pos_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_connections_one_active_per_location" ON "pos_connections" USING btree ("location_id") WHERE "pos_connections"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "pos_external_refs_local_unique" ON "pos_external_refs" USING btree ("connection_id","entity_type","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_external_refs_external_unique" ON "pos_external_refs" USING btree ("connection_id","entity_type","external_id");--> statement-breakpoint
CREATE INDEX "pos_outbox_due_idx" ON "pos_outbox" USING btree ("next_attempt_at") WHERE "pos_outbox"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "pos_outbox_connection_idx" ON "pos_outbox" USING btree ("connection_id","created_at");