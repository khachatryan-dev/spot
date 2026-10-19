"use server";

import { headers } from "next/headers";
import { getLocale } from "next-intl/server";

import { getSession } from "@/server/auth/session";
import { action } from "@/server/http/response";
import { clientIpFromHeaders } from "@/server/rate-limit/rate-limit";
import { sendContactMessage } from "@/server/services/contact-service";
import type { ContactInput } from "@/shared/schemas/contact";

export async function sendContactMessageAction(input: ContactInput) {
  return action(async () => {
    const session = await getSession();
    await sendContactMessage(input, {
      ip: clientIpFromHeaders(await headers()),
      locale: await getLocale(),
      userId: session?.user.id ?? null,
    });
    return { ok: true };
  });
}
