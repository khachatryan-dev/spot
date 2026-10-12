-- Hand-edited: the unique key must exist before menu_locations references it (drizzle-kit ordered it last).
ALTER TABLE "restaurant_locations" ADD CONSTRAINT "restaurant_locations_id_restaurant_unique" UNIQUE("id","restaurant_id");--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_categories_id_restaurant_unique" UNIQUE("id","restaurant_id")
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_minor" integer NOT NULL,
	"image_key" text,
	"ingredients" text,
	"allergens" text[] DEFAULT '{}'::text[] NOT NULL,
	"dietary_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"prep_time_minutes" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menu_items_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "menu_items_price_range" CHECK ("menu_items"."price_minor" BETWEEN 0 AND 100000000),
	CONSTRAINT "menu_items_prep_time" CHECK ("menu_items"."prep_time_minutes" IS NULL OR "menu_items"."prep_time_minutes" BETWEEN 0 AND 600),
	CONSTRAINT "menu_items_allergens_known" CHECK ("menu_items"."allergens" <@ ARRAY['gluten','crustaceans','eggs','fish','peanuts','soybeans','milk','nuts','celery','mustard','sesame','sulphites','lupin','molluscs']::text[]),
	CONSTRAINT "menu_items_dietary_known" CHECK ("menu_items"."dietary_tags" <@ ARRAY['vegetarian','vegan','spicy','halal']::text[])
);
--> statement-breakpoint
CREATE TABLE "menu_locations" (
	"menu_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"restaurant_id" uuid NOT NULL,
	CONSTRAINT "menu_locations_menu_id_location_id_pk" PRIMARY KEY("menu_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menus_id_restaurant_unique" UNIQUE("id","restaurant_id")
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"min_select" smallint DEFAULT 0 NOT NULL,
	"max_select" smallint DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modifier_groups_id_restaurant_unique" UNIQUE("id","restaurant_id"),
	CONSTRAINT "modifier_groups_selection" CHECK ("modifier_groups"."min_select" >= 0 AND "modifier_groups"."max_select" >= 1 AND "modifier_groups"."max_select" >= "modifier_groups"."min_select")
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"restaurant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_delta_minor" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modifiers_price_range" CHECK ("modifiers"."price_delta_minor" BETWEEN 0 AND 100000000)
);
--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_menu_fk" FOREIGN KEY ("menu_id","restaurant_id") REFERENCES "public"."menus"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_fk" FOREIGN KEY ("category_id","restaurant_id") REFERENCES "public"."menu_categories"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_locations" ADD CONSTRAINT "menu_locations_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_locations" ADD CONSTRAINT "menu_locations_menu_fk" FOREIGN KEY ("menu_id","restaurant_id") REFERENCES "public"."menus"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_locations" ADD CONSTRAINT "menu_locations_location_fk" FOREIGN KEY ("location_id","restaurant_id") REFERENCES "public"."restaurant_locations"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_item_fk" FOREIGN KEY ("item_id","restaurant_id") REFERENCES "public"."menu_items"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_restaurant_id_restaurants_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_group_fk" FOREIGN KEY ("group_id","restaurant_id") REFERENCES "public"."modifier_groups"("id","restaurant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_categories_menu_idx" ON "menu_categories" USING btree ("menu_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_items_category_idx" ON "menu_items" USING btree ("category_id","sort_order");--> statement-breakpoint
CREATE INDEX "menu_locations_location_idx" ON "menu_locations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "menus_restaurant_idx" ON "menus" USING btree ("restaurant_id");--> statement-breakpoint
CREATE INDEX "modifier_groups_item_idx" ON "modifier_groups" USING btree ("item_id","sort_order");--> statement-breakpoint
CREATE INDEX "modifiers_group_idx" ON "modifiers" USING btree ("group_id","sort_order");--> statement-breakpoint