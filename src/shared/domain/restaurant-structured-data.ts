import { type OpeningHours, WEEKDAYS } from "@/shared/schemas/opening-hours";

/*
 * schema.org data for a public restaurant page (§39): one `Restaurant` per
 * location, with address, hours, price range and rating, so search engines
 * can show them directly.
 */

const SCHEMA_DAYS = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
} as const;

export interface StructuredRestaurant {
  name: string;
  url: string;
  description: string | null;
  imageUrls: string[];
  cuisines: string[];
  priceRange: number | null;
  phone: string | null;
  rating: { average: number; count: number } | null;
  locations: {
    name: string;
    url: string;
    addressLine: string;
    city: string;
    postalCode: string | null;
    country: string;
    latitude: number | null;
    longitude: number | null;
    phone: string | null;
    openingHours: Partial<OpeningHours>;
    reservationsEnabled: boolean;
    bookingUrl: string | null;
  }[];
}

export function openingHoursSpecification(hours: Partial<OpeningHours>) {
  return WEEKDAYS.flatMap((day) =>
    (hours[day] ?? []).map(({ open, close }) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${SCHEMA_DAYS[day]}`,
      opens: open,
      closes: close,
    })),
  );
}

export function restaurantJsonLd(r: StructuredRestaurant) {
  const many = r.locations.length > 1;
  return r.locations.map((location) => ({
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: many ? `${r.name} — ${location.name}` : r.name,
    url: r.url,
    ...(r.description && { description: r.description }),
    ...(r.imageUrls.length > 0 && { image: r.imageUrls }),
    ...(r.cuisines.length > 0 && { servesCuisine: r.cuisines }),
    ...(r.priceRange && { priceRange: "֏".repeat(r.priceRange) }),
    ...((location.phone ?? r.phone) && { telephone: location.phone ?? r.phone }),
    address: {
      "@type": "PostalAddress",
      streetAddress: location.addressLine,
      addressLocality: location.city,
      ...(location.postalCode && { postalCode: location.postalCode }),
      addressCountry: location.country,
    },
    ...(location.latitude !== null &&
      location.longitude !== null && {
        geo: {
          "@type": "GeoCoordinates",
          latitude: location.latitude,
          longitude: location.longitude,
        },
      }),
    openingHoursSpecification: openingHoursSpecification(location.openingHours),
    acceptsReservations: location.reservationsEnabled ? (location.bookingUrl ?? true) : false,
    ...(r.rating &&
      r.rating.count > 0 && {
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: r.rating.average,
          reviewCount: r.rating.count,
          bestRating: 5,
          worstRating: 1,
        },
      }),
  }));
}

/** JSON for an inline <script>, safe against "</script>" in restaurant-written text. */
export const safeJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
