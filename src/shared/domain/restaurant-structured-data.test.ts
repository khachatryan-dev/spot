import { describe, expect, it } from "vitest";

import {
  openingHoursSpecification,
  restaurantJsonLd,
  safeJsonLd,
} from "./restaurant-structured-data";

const base = {
  name: "Ararat",
  url: "https://spot.am/r/ararat",
  description: "Grill",
  imageUrls: ["https://img.spot.am/cover.webp"],
  cuisines: ["armenian"],
  priceRange: 2,
  phone: "+37410000000",
  rating: { average: 4.5, count: 12 },
};
const location = {
  name: "Center",
  url: "https://spot.am/r/ararat",
  addressLine: "1 Abovyan St",
  city: "Yerevan",
  postalCode: "0001",
  country: "AM",
  latitude: 40.18,
  longitude: 44.51,
  phone: null,
  openingHours: { fri: [{ open: "18:00", close: "02:00" }] },
  reservationsEnabled: true,
  bookingUrl: "https://spot.am/r/ararat/center/reserve",
};

describe("restaurantJsonLd", () => {
  it("describes one location as a Restaurant with address, hours, price and rating", () => {
    const [data] = restaurantJsonLd({ ...base, locations: [location] });
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: "Ararat",
      servesCuisine: ["armenian"],
      priceRange: "֏֏",
      telephone: "+37410000000",
      address: { streetAddress: "1 Abovyan St", addressLocality: "Yerevan", addressCountry: "AM" },
      geo: { latitude: 40.18, longitude: 44.51 },
      acceptsReservations: "https://spot.am/r/ararat/center/reserve",
      aggregateRating: { ratingValue: 4.5, reviewCount: 12 },
    });
  });

  it("names each location when there are several, and omits what's unknown", () => {
    const data = restaurantJsonLd({
      ...base,
      description: null,
      imageUrls: [],
      priceRange: null,
      phone: null,
      rating: { average: 0, count: 0 },
      locations: [
        location,
        {
          ...location,
          name: "Komitas",
          latitude: null,
          longitude: null,
          reservationsEnabled: false,
        },
      ],
    });
    expect(data.map((d) => d.name)).toEqual(["Ararat — Center", "Ararat — Komitas"]);
    expect(data[1]).not.toHaveProperty("geo");
    expect(data[1]).not.toHaveProperty("aggregateRating");
    expect(data[1]).not.toHaveProperty("priceRange");
    expect(data[1]!.acceptsReservations).toBe(false);
  });

  it("lists opening periods per day", () => {
    expect(openingHoursSpecification({ mon: [{ open: "09:00", close: "22:00" }] })).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Monday",
        opens: "09:00",
        closes: "22:00",
      },
    ]);
  });

  it("can't break out of its script tag", () => {
    expect(safeJsonLd({ description: "</script><script>alert(1)</script>" })).not.toContain("<");
  });
});
