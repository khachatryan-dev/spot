import { pgEnum } from "drizzle-orm/pg-core";

import { PLATFORM_ROLES, RESTAURANT_ROLES, USER_STATUSES } from "@/shared/constants/roles";

export const platformRole = pgEnum("platform_role", PLATFORM_ROLES);
export const restaurantRole = pgEnum("restaurant_role", RESTAURANT_ROLES);
export const userStatus = pgEnum("user_status", USER_STATUSES);
