import "server-only";

import { MAX_UPLOAD_BYTES } from "@/server/images/process-image";
import { AppError } from "@/shared/errors";

/** Read the `file` field of a multipart upload, rejecting oversized bodies early. */
export async function readUploadedFile(request: Request): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 64 * 1024) {
    throw new AppError("VALIDATION_ERROR", "Image is larger than 5 MB.", {
      fieldErrors: { file: ["imageTooLarge"] },
    });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    throw new AppError("VALIDATION_ERROR", "No file uploaded.", {
      fieldErrors: { file: ["imageInvalid"] },
    });
  }
  return new Uint8Array(await file.arrayBuffer());
}
