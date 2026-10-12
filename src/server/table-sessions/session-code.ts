import { randomInt } from "node:crypto";

/** No 0/O or 1/I/L: easy to read out loud and type. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Short human-readable session code, e.g. "K7M2QX". Display only — never an access key. */
export function generateSessionCode(): string {
  return Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
