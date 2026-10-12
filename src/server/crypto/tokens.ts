import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, URL-safe. Give it to the user; store only its hash. */
export const createToken = () => randomBytes(32).toString("base64url");

/** SHA-256 hex digest used to look tokens up without storing them. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
