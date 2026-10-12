import { clientEnv } from "@/shared/config/env.client";

/** Public booking page for a location, to share (Instagram, website, maps). */
export function bookingPath(restaurantSlug: string, locationSlug: string): string {
  return `/r/${restaurantSlug}/${locationSlug}/reserve`;
}

export function bookingUrl(restaurantSlug: string, locationSlug: string): string {
  return `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${bookingPath(restaurantSlug, locationSlug)}`;
}
