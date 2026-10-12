import { db } from "@/server/db/client";
import {
  diningTables,
  restaurantLocations,
  restaurants,
  restaurantStaff,
  users,
} from "@/server/db/schema";

/*
 * Shared setup for reservation integration tests: an active restaurant open
 * Friday 18:00–02:00 in Yerevan (UTC+4) with reservations on.
 * 2030-01-18 is a Friday.
 */

export const FRIDAY = "2030-01-18";
export const local = (hhmm: string, date = FRIDAY) => new Date(`${date}T${hhmm}:00+04:00`);
/** The day before, in the morning. */
export const NOW = local("10:00", "2030-01-17");
export const MINUTE = 60_000;

export async function guest(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  return user!;
}

export async function reservationSetup(
  tableSizes: number[] = [4],
  locationOverrides: Partial<typeof restaurantLocations.$inferInsert> = {},
) {
  const [restaurant] = await db
    .insert(restaurants)
    .values({ name: "Cafe", slug: "cafe", status: "active" })
    .returning();
  const [location] = await db
    .insert(restaurantLocations)
    .values({
      restaurantId: restaurant!.id,
      name: "Main",
      slug: "main",
      addressLine: "1 St",
      city: "Yerevan",
      reservationsEnabled: true,
      openingHours: {
        mon: [],
        tue: [],
        wed: [],
        thu: [],
        fri: [{ open: "18:00", close: "02:00" }],
        sat: [],
        sun: [],
      },
      ...locationOverrides,
    })
    .returning();
  const tables = await db
    .insert(diningTables)
    .values(
      tableSizes.map((capacity, i) => ({
        restaurantId: restaurant!.id,
        locationId: location!.id,
        number: String(i + 1),
        capacity,
      })),
    )
    .returning();
  /** Hold input for a time on Friday (or `date`). */
  const holdInput = (time = "19:00", partySize = 2, date?: string) => ({
    restaurantId: restaurant!.id,
    locationId: location!.id,
    startsAt: local(time, date),
    partySize,
  });
  return { restaurant: restaurant!, location: location!, tables, holdInput };
}

export async function staffMember(
  restaurantId: string,
  email: string,
  role: "owner" | "manager" | "waiter" | "kitchen" | "cashier",
) {
  const user = await guest(email);
  await db.insert(restaurantStaff).values({ restaurantId, userId: user.id, role });
  return user;
}
