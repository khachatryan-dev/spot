import { ZodError } from "zod";

import { AppError, type FieldErrors } from "@/shared/errors";

/** Normalize anything thrown into an AppError that is safe to return. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    const fieldErrors: FieldErrors = {};
    for (const issue of error.issues) {
      const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return new AppError("VALIDATION_ERROR", undefined, { cause: error, fieldErrors });
  }

  // Unknown errors keep their details in `cause` only — never in the response.
  return new AppError("INTERNAL_ERROR", undefined, { cause: error });
}
