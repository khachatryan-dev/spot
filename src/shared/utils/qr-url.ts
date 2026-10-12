import { clientEnv } from "@/shared/config/env.client";

/** Public link encoded in a table's QR code. Locale-free: guests get their own language. */
export function qrUrl(token: string): string {
  return `${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/t/${token}`;
}
