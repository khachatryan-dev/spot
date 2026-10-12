import { requireUser } from "@/server/auth/guards";
import { ok, route } from "@/server/http/response";
import { readUploadedFile } from "@/server/http/read-upload";
import { assertSameOrigin } from "@/server/http/same-origin";
import {
  RESTAURANT_IMAGE_KINDS,
  type RestaurantImageKind,
  removeRestaurantImage,
  uploadRestaurantImage,
} from "@/server/services/restaurant-image-service";
import { AppError } from "@/shared/errors";

type Context = RouteContext<"/api/restaurants/[restaurantId]/images/[kind]">;

async function parseParams(context: Context) {
  const { restaurantId, kind } = await context.params;
  if (!RESTAURANT_IMAGE_KINDS.includes(kind as RestaurantImageKind))
    throw new AppError("NOT_FOUND");
  return { restaurantId, kind: kind as RestaurantImageKind };
}

/** Upload a logo or cover: multipart/form-data with a `file` field (≤ 5 MB). */
export const POST = route(async (request: Request, context: Context) => {
  assertSameOrigin(request);
  const user = await requireUser();
  const { restaurantId, kind } = await parseParams(context);

  const result = await uploadRestaurantImage(
    user,
    restaurantId,
    kind,
    await readUploadedFile(request),
  );
  return ok(result, { status: 201 });
});

export const DELETE = route(async (request: Request, context: Context) => {
  assertSameOrigin(request);
  const user = await requireUser();
  const { restaurantId, kind } = await parseParams(context);
  await removeRestaurantImage(user, restaurantId, kind);
  return ok({ ok: true });
});
