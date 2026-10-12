import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/db/errors";
import {
  diningTables,
  type TableRequest,
  tableRequests,
  tableSessionMembers,
} from "@/server/db/schema";
import { publishOrderEvent } from "@/server/events/order-events";
import type { Customer } from "@/server/guests/current-customer";
import { authorizeRestaurant } from "@/server/policies/restaurant-access";
import { hitRateLimit } from "@/server/rate-limit/rate-limit";
import {
  OPEN_REQUEST_STATUSES,
  TABLE_REQUEST_TYPES,
  type TableRequestStatus,
  type TableRequestType,
} from "@/shared/constants/table-requests";
import { AppError } from "@/shared/errors";

import { getCustomerTableSession } from "./table-session-service";

/*
 * Table requests (§18). Guests ask; staff with table_request:respond
 * acknowledge and complete. One open request per type per visit.
 */

const REQUEST_LIMIT = { max: 15, windowMs: 10 * 60 * 1000 };
const noteSchema = z.string().trim().max(200).optional();

async function locationOf(tableId: string) {
  const [table] = await db
    .select({ locationId: diningTables.locationId })
    .from(diningTables)
    .where(eq(diningTables.id, tableId));
  return table!.locationId;
}

async function publish(request: TableRequest) {
  await publishOrderEvent({
    type: "TABLE_REQUEST_CHANGED",
    restaurantId: request.restaurantId,
    locationId: await locationOf(request.tableId),
    tableSessionId: request.tableSessionId,
    requestId: request.id,
    status: request.status,
  });
}

async function requireSession(customer: Customer, sessionId: string | undefined) {
  const session = await getCustomerTableSession(customer, sessionId);
  if (!session)
    throw new AppError("NOT_FOUND", "Your table visit has ended. Scan the QR code again.");
  return session;
}

/** Ask for service. Asking again for the same thing returns the open request. */
export async function createTableRequest(
  customer: Customer,
  sessionId: string | undefined,
  input: { type: TableRequestType; note?: string },
): Promise<TableRequest> {
  const session = await requireSession(customer, sessionId);
  const type = z.enum(TABLE_REQUEST_TYPES).parse(input.type);
  const note = noteSchema.parse(input.note) || null;

  const open = async () =>
    (
      await db
        .select()
        .from(tableRequests)
        .where(
          and(
            eq(tableRequests.tableSessionId, session.sessionId),
            eq(tableRequests.type, type),
            inArray(tableRequests.status, OPEN_REQUEST_STATUSES),
          ),
        )
    )[0];
  const existing = await open();
  if (existing) return existing;

  if (!(await hitRateLimit(`request:${session.sessionId}`, REQUEST_LIMIT)).allowed) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests. A staff member will be with you shortly.",
    );
  }

  const [member] = await db
    .select({ id: tableSessionMembers.id })
    .from(tableSessionMembers)
    .where(
      and(
        eq(tableSessionMembers.sessionId, session.sessionId),
        customer.type === "user"
          ? eq(tableSessionMembers.userId, customer.user.id)
          : eq(tableSessionMembers.guestId, customer.guest.id),
      ),
    );
  try {
    const [created] = await db
      .insert(tableRequests)
      .values({
        restaurantId: session.restaurant.id,
        tableId: session.table.id,
        tableSessionId: session.sessionId,
        memberId: member?.id ?? null,
        type,
        note,
      })
      .returning();
    await publish(created!);
    return created!;
  } catch (error) {
    // Two taps at once: the other one created it.
    if (isUniqueViolation(error, "table_requests_one_open_per_type")) {
      const raced = await open();
      if (raced) return raced;
    }
    throw error;
  }
}

/** Open requests at the guest's table (everyone at the table sees them). */
export async function listTableRequestsForCustomer(
  customer: Customer,
  sessionId: string | undefined,
) {
  const session = await getCustomerTableSession(customer, sessionId);
  if (!session) return [];
  return db
    .select({
      id: tableRequests.id,
      type: tableRequests.type,
      status: tableRequests.status,
      createdAt: tableRequests.createdAt,
    })
    .from(tableRequests)
    .where(
      and(
        eq(tableRequests.tableSessionId, session.sessionId),
        inArray(tableRequests.status, OPEN_REQUEST_STATUSES),
      ),
    )
    .orderBy(asc(tableRequests.createdAt));
}

/** The guest withdraws a request that hasn't been handled yet. */
export async function cancelTableRequest(
  customer: Customer,
  sessionId: string | undefined,
  requestId: string,
) {
  const session = await requireSession(customer, sessionId);
  if (!z.uuid().safeParse(requestId).success) throw new AppError("NOT_FOUND", "Request not found.");
  const [cancelled] = await db
    .update(tableRequests)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(tableRequests.id, requestId),
        eq(tableRequests.tableSessionId, session.sessionId),
        inArray(tableRequests.status, OPEN_REQUEST_STATUSES),
      ),
    )
    .returning();
  if (!cancelled) throw new AppError("NOT_FOUND", "Request not found.");
  await publish(cancelled);
}

export interface StaffTableRequest {
  id: string;
  type: TableRequestType;
  status: TableRequestStatus;
  note: string | null;
  tableNumber: string;
  createdAt: Date;
}

/** Open requests at a location, oldest first, for waiters and managers. */
export async function listOpenTableRequests(
  actor: Pick<SessionUser, "id">,
  restaurantId: string,
  locationId: string,
): Promise<StaffTableRequest[]> {
  await authorizeRestaurant(actor.id, restaurantId, "table_request:respond");
  if (!z.uuid().safeParse(locationId).success)
    throw new AppError("NOT_FOUND", "Location not found.");
  return db
    .select({
      id: tableRequests.id,
      type: tableRequests.type,
      status: tableRequests.status,
      note: tableRequests.note,
      tableNumber: diningTables.number,
      createdAt: tableRequests.createdAt,
    })
    .from(tableRequests)
    .innerJoin(diningTables, eq(diningTables.id, tableRequests.tableId))
    .where(
      and(
        eq(tableRequests.restaurantId, restaurantId),
        eq(diningTables.locationId, locationId),
        inArray(tableRequests.status, OPEN_REQUEST_STATUSES),
      ),
    )
    .orderBy(asc(tableRequests.createdAt));
}

/** Staff: pending → acknowledged → completed (or pending → completed directly). */
export async function updateTableRequest(
  actor: Pick<SessionUser, "id">,
  restaurantId: string,
  requestId: string,
  to: "acknowledged" | "completed",
): Promise<TableRequest> {
  await authorizeRestaurant(actor.id, restaurantId, "table_request:respond");
  if (!z.uuid().safeParse(requestId).success) throw new AppError("NOT_FOUND", "Request not found.");
  const target = z.enum(["acknowledged", "completed"]).parse(to);
  const allowedFrom: TableRequestStatus[] =
    target === "acknowledged" ? ["pending"] : ["pending", "acknowledged"];
  const now = new Date();

  const [updated] = await db
    .update(tableRequests)
    .set(
      target === "acknowledged"
        ? { status: target, acknowledgedAt: now, acknowledgedByUserId: actor.id }
        : {
            status: target,
            completedAt: now,
            completedByUserId: actor.id,
            acknowledgedAt: sql`coalesce(${tableRequests.acknowledgedAt}, ${now.toISOString()}::timestamptz)`,
          },
    )
    .where(
      and(
        eq(tableRequests.id, requestId),
        eq(tableRequests.restaurantId, restaurantId),
        inArray(tableRequests.status, allowedFrom),
      ),
    )
    .returning();
  if (!updated) throw new AppError("CONFLICT", "This request was already handled.");
  await publish(updated);
  return updated;
}
