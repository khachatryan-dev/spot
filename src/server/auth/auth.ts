import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { guestTokenFromCookieHeader } from "@/server/guests/guest-cookie";
import { claimGuest, findGuestByToken } from "@/server/guests/guest-service";
import { accounts, rateLimits, sessions, users, verifications } from "@/server/db/schema";
import { logger } from "@/server/logger";
import { env } from "@/shared/config/env";
import { clientEnv } from "@/shared/config/env.client";
import { PLATFORM_ROLES, USER_STATUSES } from "@/shared/constants/roles";

const log = logger.child({ module: "auth" });

const DAY = 60 * 60 * 24;

/** Google sign-in is offered only when both credentials are configured. */
const google =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
    : null;
export const isGoogleEnabled = google !== null;

export const auth = betterAuth({
  appName: "Spot",
  baseURL: env.AUTH_URL ?? clientEnv.NEXT_PUBLIC_APP_URL,
  secret: env.AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      rateLimit: rateLimits,
    },
  }),

  advanced: {
    // Let Postgres generate uuid primary keys (gen_random_uuid()).
    database: { generateId: "uuid" },
    cookiePrefix: "spot",
    // Secure cookies whenever the site runs on https (always in production).
    useSecureCookies: env.NODE_ENV === "production",
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    // Email delivery arrives with notifications; until then sign-up isn't blocked on it.
    requireEmailVerification: false,
    revokeSessionsOnPasswordReset: true,
  },

  // Redirect URI to register in Google Cloud: {AUTH_URL}/api/auth/callback/google
  socialProviders: google ? { google: { ...google, prompt: "select_account" } } : {},

  account: {
    // A Google login with the same (Google-verified) email joins the existing account.
    accountLinking: { enabled: true, trustedProviders: ["google"] },
  },

  user: {
    additionalFields: {
      // Never accepted from the client (§9, §30): roles and status change only server-side.
      platformRole: {
        type: [...PLATFORM_ROLES],
        required: true,
        defaultValue: "customer",
        input: false,
      },
      status: { type: [...USER_STATUSES], required: true, defaultValue: "active", input: false },
      phone: { type: "string", required: false, input: false },
      preferredLocale: { type: "string", required: false },
      lastLoginAt: { type: "date", required: false, input: false },
    },
  },

  session: {
    expiresIn: 30 * DAY,
    // Extend the session at most once a day while the user is active.
    updateAge: DAY,
    // No cookie cache: every check hits the database, so revocation and
    // suspension take effect immediately.
  },

  rateLimit: {
    enabled: env.NODE_ENV !== "test",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60 * 60, max: 5 },
      "/request-password-reset": { window: 60 * 60, max: 3 },
    },
  },

  databaseHooks: {
    session: {
      create: {
        // Suspended users cannot start new sessions.
        before: async (session) => {
          const [user] = await db
            .select({ status: users.status })
            .from(users)
            .where(eq(users.id, session.userId));
          if (user?.status !== "active") {
            log.warn("Blocked sign-in for inactive user", { userId: session.userId });
            return false;
          }
        },
        after: async (session, ctx) => {
          await db
            .update(users)
            .set({ lastLoginAt: new Date() })
            .where(eq(users.id, session.userId));

          // A QR guest who signs in or signs up keeps their history (§25).
          const guestToken = guestTokenFromCookieHeader(ctx?.headers?.get("cookie"));
          const guest = await findGuestByToken(guestToken);
          if (guest && (await claimGuest(guest.id, session.userId))) {
            log.info("Guest claimed by user", { guestId: guest.id, userId: session.userId });
          }
        },
      },
    },
  },

  // Lets Server Actions set auth cookies; must stay the last plugin.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
