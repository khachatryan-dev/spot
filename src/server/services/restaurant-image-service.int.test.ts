import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server/db/client";
import { menuItems, restaurants, restaurantStaff, users } from "@/server/db/schema";
import { AppError } from "@/shared/errors";
import { imageUrl } from "@/shared/utils/image-url";
import { hitRateLimit } from "@/server/rate-limit/rate-limit";
import { truncate } from "@/test/db";

import { createCategory, createItem, createMenu } from "./menu-service";
import {
  removeMenuItemImage,
  removeRestaurantImage,
  uploadMenuItemImage,
  UPLOAD_LIMIT,
  uploadRestaurantImage,
} from "./restaurant-image-service";
import { createRestaurant } from "./restaurant-service";

beforeEach(() => truncate(db, ["restaurant_staff", "restaurants", "users"]));

async function createUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  return user!;
}

const png = async (w = 800, h = 600) =>
  new Uint8Array(
    await sharp({ create: { width: w, height: h, channels: 3, background: "#c84" } })
      .png()
      .toBuffer(),
  );

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (e instanceof AppError ? e.code : e),
  );

/** Status of the public URL, as a browser would see it. */
const publicStatus = async (key: string) => (await fetch(imageUrl(key)!)).status;

describe("restaurant images", () => {
  it("stores a re-encoded WebP and serves it publicly", async () => {
    const owner = await createUser("owner@example.am");
    const restaurant = await createRestaurant(owner, { name: "Cafe" });

    const { key } = await uploadRestaurantImage(owner, restaurant.id, "cover", await png());
    expect(key).toMatch(new RegExp(`^restaurants/${restaurant.id}/cover/[0-9a-f-]{36}\\.webp$`));

    const response = await fetch(imageUrl(key)!);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    const [row] = await db.select().from(restaurants);
    expect(row?.coverImageKey).toBe(key);
  });

  it("deletes the previous image when replaced or removed", async () => {
    const owner = await createUser("owner@example.am");
    const restaurant = await createRestaurant(owner, { name: "Cafe" });

    const first = await uploadRestaurantImage(owner, restaurant.id, "logo", await png(300, 300));
    const second = await uploadRestaurantImage(owner, restaurant.id, "logo", await png(400, 400));
    expect(await publicStatus(first.key)).toBe(404);
    expect(await publicStatus(second.key)).toBe(200);

    await removeRestaurantImage(owner, restaurant.id, "logo");
    expect(await publicStatus(second.key)).toBe(404);
    const [row] = await db.select().from(restaurants);
    expect(row?.logoKey).toBeNull();
  });

  it("allows only the owner of this restaurant", async () => {
    const owner = await createUser("owner@example.am");
    const manager = await createUser("manager@example.am");
    const outsider = await createUser("out@example.am");
    const restaurant = await createRestaurant(owner, { name: "Cafe" });
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: restaurant.id, userId: manager.id, role: "manager" });

    expect(await codeOf(uploadRestaurantImage(manager, restaurant.id, "logo", await png()))).toBe(
      "FORBIDDEN",
    );
    expect(await codeOf(uploadRestaurantImage(outsider, restaurant.id, "logo", await png()))).toBe(
      "NOT_FOUND",
    );
  });

  it("rejects non-images without storing anything", async () => {
    const owner = await createUser("owner@example.am");
    const restaurant = await createRestaurant(owner, { name: "Cafe" });
    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
    );

    expect(await codeOf(uploadRestaurantImage(owner, restaurant.id, "logo", svg))).toBe(
      "VALIDATION_ERROR",
    );
    const [row] = await db.select().from(restaurants);
    expect(row?.logoKey).toBeNull();
  });

  it("caps uploads per person", async () => {
    const owner = await createUser("owner@example.am");
    const restaurant = await createRestaurant(owner, { name: "Cafe" });
    for (let i = 0; i < UPLOAD_LIMIT.max; i++) {
      await hitRateLimit(`upload:${owner.id}`, UPLOAD_LIMIT);
    }

    expect(await codeOf(uploadRestaurantImage(owner, restaurant.id, "logo", await png()))).toBe(
      "RATE_LIMITED",
    );
    const [row] = await db.select().from(restaurants);
    expect(row?.logoKey).toBeNull();
  });
});

describe("menu item images", () => {
  async function itemFor(ownerEmail: string) {
    const owner = await createUser(ownerEmail);
    const restaurant = await createRestaurant(owner, { name: `${ownerEmail.split("@")[0]} cafe` });
    const menu = await createMenu(owner, restaurant.id, { name: "Main" });
    const category = await createCategory(owner, restaurant.id, menu.id, { name: "Pizza" });
    const item = await createItem(owner, restaurant.id, {
      categoryId: category.id,
      name: "Margherita",
      priceMinor: 350000,
    });
    return { owner, restaurant, item };
  }

  it("stores the photo, replaces the old one and removes it", async () => {
    const { owner, restaurant, item } = await itemFor("owner@example.am");

    const first = await uploadMenuItemImage(owner, restaurant.id, item.id, await png(600, 600));
    expect(first.key).toMatch(
      new RegExp(`^restaurants/${restaurant.id}/menu/${item.id}/.+\\.webp$`),
    );
    const second = await uploadMenuItemImage(owner, restaurant.id, item.id, await png(700, 700));
    expect(await publicStatus(first.key)).toBe(404);
    expect(await publicStatus(second.key)).toBe(200);

    await removeMenuItemImage(owner, restaurant.id, item.id);
    expect(await publicStatus(second.key)).toBe(404);
    const [row] = await db.select().from(menuItems);
    expect(row?.imageKey).toBeNull();
  });

  it("refuses other restaurants' items, kitchen staff and too-small photos", async () => {
    const mine = await itemFor("mine@example.am");
    const theirs = await itemFor("theirs@example.am");
    const cook = await createUser("cook@example.am");
    await db
      .insert(restaurantStaff)
      .values({ restaurantId: mine.restaurant.id, userId: cook.id, role: "kitchen" });

    expect(
      await codeOf(
        uploadMenuItemImage(mine.owner, mine.restaurant.id, theirs.item.id, await png()),
      ),
    ).toBe("NOT_FOUND");
    expect(
      await codeOf(uploadMenuItemImage(cook, mine.restaurant.id, mine.item.id, await png())),
    ).toBe("FORBIDDEN");
    expect(
      await codeOf(
        uploadMenuItemImage(mine.owner, mine.restaurant.id, mine.item.id, await png(100, 100)),
      ),
    ).toBe("VALIDATION_ERROR");
  });
});
