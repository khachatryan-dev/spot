import "server-only";

import sharp, { type Metadata, type Sharp } from "sharp";

import { AppError } from "@/shared/errors";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Refuse images that would decode to more pixels than this (decompression bombs). */
const MAX_INPUT_PIXELS = 40_000_000;

export type ImageType = "jpeg" | "png" | "webp";

/**
 * Identify the real file type from its first bytes — never trust the file name
 * or the browser's Content-Type. Anything else (SVG, GIF, HEIC, PDF…) is null.
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith(0xff, 0xd8, 0xff)) return "jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  // RIFF....WEBP
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    [0x57, 0x45, 0x42, 0x50].every((b, i) => bytes[8 + i] === b)
  ) {
    return "webp";
  }
  return null;
}

export interface ImagePreset {
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
}

export const IMAGE_PRESETS = {
  logo: { maxWidth: 512, maxHeight: 512, minWidth: 64, minHeight: 64 },
  cover: { maxWidth: 1920, maxHeight: 1080, minWidth: 600, minHeight: 300 },
  menuItem: { maxWidth: 1200, maxHeight: 1200, minWidth: 300, minHeight: 300 },
} satisfies Record<string, ImagePreset>;

/**
 * Validate and normalize an uploaded image (§31): checks type, size and
 * dimensions, then re-encodes to WebP. Re-encoding drops all metadata (EXIF,
 * including GPS) and anything hidden in the original file.
 */
export async function processImage(
  bytes: Uint8Array,
  preset: ImagePreset,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  if (bytes.byteLength === 0) throw invalid("Empty file.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw invalid("Image is larger than 5 MB.");
  if (!detectImageType(bytes)) throw invalid("Only JPEG, PNG or WebP images are allowed.");

  let image: Sharp;
  let metadata: Metadata;
  try {
    image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    metadata = await image.metadata();
  } catch {
    throw invalid("The image could not be read.");
  }

  const { width = 0, height = 0 } = metadata;
  // EXIF orientations 5–8 swap width and height once rotated.
  const [w, h] = (metadata.orientation ?? 1) >= 5 ? [height, width] : [width, height];
  if (w < preset.minWidth || h < preset.minHeight) {
    throw invalid(`Image must be at least ${preset.minWidth}×${preset.minHeight} pixels.`);
  }

  try {
    const { data, info } = await image
      .rotate() // apply EXIF orientation, then metadata is dropped
      .resize({
        width: preset.maxWidth,
        height: preset.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height };
  } catch {
    throw invalid("The image could not be processed.");
  }
}

function invalid(message: string) {
  return new AppError("VALIDATION_ERROR", message, { fieldErrors: { file: ["imageInvalid"] } });
}
