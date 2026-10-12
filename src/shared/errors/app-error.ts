/**
 * Typed application errors (§34).
 *
 * `message` is always safe to show a user. Internal details go in `cause`,
 * which is logged but never sent to the client.
 */
export const ERROR_CODES = {
  UNAUTHORIZED: { status: 401, message: "Please sign in to continue." },
  FORBIDDEN: { status: 403, message: "You don't have permission to do this." },
  NOT_FOUND: { status: 404, message: "Not found." },
  VALIDATION_ERROR: { status: 400, message: "Some fields are invalid." },
  CONFLICT: { status: 409, message: "This conflicts with the current state." },
  RESOURCE_UNAVAILABLE: { status: 409, message: "This is no longer available." },
  PAYMENT_FAILED: { status: 402, message: "The payment could not be completed." },
  RESERVATION_UNAVAILABLE: { status: 409, message: "This reservation slot is not available." },
  ORDER_UNAVAILABLE: { status: 409, message: "This order cannot be placed right now." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Please try again shortly." },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong. Please try again." },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Field-level validation messages, e.g. `{ email: ["Invalid email"] }`. */
export type FieldErrors = Record<string, string[]>;

export interface ApiError {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
}

/** Shape of every API response and Server Action result (§33). */
export type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldErrors;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { cause?: unknown; fieldErrors?: FieldErrors },
  ) {
    super(message ?? ERROR_CODES[code].message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.fieldErrors = options?.fieldErrors;
  }

  toJSON(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.fieldErrors && { fieldErrors: this.fieldErrors }),
    };
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
