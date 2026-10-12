-- Restaurant search (§26): typo-tolerant name matching with trigrams.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restaurants_name_trgm" ON "restaurants" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "restaurant_locations_city_idx" ON "restaurant_locations" (lower("city"));
