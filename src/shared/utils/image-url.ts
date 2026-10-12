import { clientEnv } from "@/shared/config/env.client";

/** Public URL for a stored image key, or null if no image / storage isn't configured. */
export function imageUrl(key: string | null | undefined): string | null {
  const base = clientEnv.NEXT_PUBLIC_STORAGE_URL;
  if (!key || !base) return null;
  return `${base.replace(/\/$/, "")}/${key}`;
}
