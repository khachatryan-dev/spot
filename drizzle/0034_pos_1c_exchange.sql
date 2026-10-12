CREATE TABLE "pos_catalog_snapshots" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"menu" jsonb,
	"tables" jsonb,
	"stock" jsonb,
	"catalog_received_at" timestamp with time zone,
	"stock_received_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pos_connections" ADD COLUMN "secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "pos_connections" ADD COLUMN "exchange_token_hash" text;--> statement-breakpoint
ALTER TABLE "pos_catalog_snapshots" ADD CONSTRAINT "pos_catalog_snapshots_connection_id_pos_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."pos_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_connections" ADD CONSTRAINT "pos_connections_exchangeTokenHash_unique" UNIQUE("exchange_token_hash");