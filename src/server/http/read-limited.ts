import "server-only";

import { AppError } from "@/shared/errors";

/**
 * Read a request body as text, refusing more than `maxBytes` — without
 * buffering an oversized body first (Content-Length can be missing or wrong).
 */
export async function readLimitedText(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new AppError("VALIDATION_ERROR", "Request body too large.");
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AppError("VALIDATION_ERROR", "Request body too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
