import { requireUser } from "@/server/auth/guards";
import { readUploadedFile } from "@/server/http/read-upload";
import { ok, route } from "@/server/http/response";
import { assertSameOrigin } from "@/server/http/same-origin";
import {
  removeMenuItemImage,
  uploadMenuItemImage,
} from "@/server/services/restaurant-image-service";

type Context = RouteContext<"/api/restaurants/[restaurantId]/menu-items/[itemId]/image">;

/** Upload a menu item photo: multipart/form-data with a `file` field (≤ 5 MB). */
export const POST = route(async (request: Request, context: Context) => {
  assertSameOrigin(request);
  const user = await requireUser();
  const { restaurantId, itemId } = await context.params;
  const result = await uploadMenuItemImage(
    user,
    restaurantId,
    itemId,
    await readUploadedFile(request),
  );
  return ok(result, { status: 201 });
});

export const DELETE = route(async (request: Request, context: Context) => {
  assertSameOrigin(request);
  const user = await requireUser();
  const { restaurantId, itemId } = await context.params;
  await removeMenuItemImage(user, restaurantId, itemId);
  return ok({ ok: true });
});
