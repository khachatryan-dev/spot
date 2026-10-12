/** Keys whose values must never reach logs (§41). Matched case-insensitively, by substring. */
const SENSITIVE_KEY_PARTS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "card",
  "cvv",
  "iban",
  "session",
];

export const REDACTED = "[REDACTED]";

const isSensitiveKey = (key: string) => {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
};

/** Turn an Error (and its cause chain) into plain, loggable data. */
export function serializeError(error: unknown, depth = 0): unknown {
  if (!(error instanceof Error)) return error;
  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  if ("code" in error) serialized.code = error.code;
  if (error.cause !== undefined && depth < 3) {
    serialized.cause = serializeError(error.cause, depth + 1);
  }
  return serialized;
}

/** Deep-copy `value`, replacing sensitive fields and serializing errors. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) return redact(serializeError(value), depth, seen);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth > 8) return "[Truncated]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen));

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redact(item, depth + 1, seen);
  }
  return result;
}
