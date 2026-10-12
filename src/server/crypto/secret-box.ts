import "server-only";

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { env } from "@/shared/config/env";

/*
 * Encryption at rest for secrets Spot must send back out (a POS password).
 * AES-256-GCM with a key derived from AUTH_SECRET, so no extra variable to
 * manage. Rotating AUTH_SECRET makes stored secrets unreadable: they must be
 * entered again.
 */

const VERSION = "v1";
let cachedKey: Buffer | undefined;
const key = () =>
  (cachedKey ??= Buffer.from(hkdfSync("sha256", env.AUTH_SECRET, "spot", "secret-box:v1", 32)));

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

/** The secret, or null if it can't be read (corrupt, or AUTH_SECRET changed). */
export function decryptSecret(sealed: string): string | null {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
