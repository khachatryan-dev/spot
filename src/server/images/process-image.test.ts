import sharp, { type Sharp } from "sharp";
import { describe, expect, it } from "vitest";

import { AppError } from "@/shared/errors";

import { detectImageType, IMAGE_PRESETS, MAX_UPLOAD_BYTES, processImage } from "./process-image";

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } });

const bytes = async (img: Sharp) => new Uint8Array(await img.toBuffer());

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).message;
}

describe("detectImageType", () => {
  it("recognizes JPEG, PNG and WebP by their bytes", async () => {
    expect(detectImageType(await bytes(solid(10, 10).jpeg()))).toBe("jpeg");
    expect(detectImageType(await bytes(solid(10, 10).png()))).toBe("png");
    expect(detectImageType(await bytes(solid(10, 10).webp()))).toBe("webp");
  });

  it("rejects SVG, GIF, HTML and other files regardless of name", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(detectImageType(svg)).toBeNull();
    expect(detectImageType(await bytes(solid(10, 10).gif()))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("<html><body>hi</body></html>"))).toBeNull();
    expect(detectImageType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // %PDF
  });
});

describe("processImage", () => {
  it("re-encodes to WebP and shrinks to the preset", async () => {
    const result = await processImage(await bytes(solid(2000, 1000).jpeg()), IMAGE_PRESETS.logo);
    expect(detectImageType(result.data)).toBe("webp");
    expect([result.width, result.height]).toEqual([512, 256]);
  });

  it("never enlarges small images", async () => {
    const result = await processImage(await bytes(solid(800, 400).png()), IMAGE_PRESETS.cover);
    expect([result.width, result.height]).toEqual([800, 400]);
  });

  it("strips EXIF metadata such as GPS location", async () => {
    const withExif = await bytes(
      solid(300, 300)
        .jpeg()
        .withExif({
          IFD0: { Make: "PhoneMaker", Model: "Secret Phone" },
          IFD3: { GPSLatitudeRef: "N" },
        }),
    );
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const result = await processImage(withExif, IMAGE_PRESETS.logo);
    const meta = await sharp(result.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(Buffer.from(result.data).toString("latin1")).not.toContain("Secret Phone");
  });

  it("rejects images below the minimum size", async () => {
    expect(
      await rejection(processImage(await bytes(solid(40, 40).png()), IMAGE_PRESETS.logo)),
    ).toMatch(/at least/);
  });

  it("rejects disguised and empty files", async () => {
    const svg = new TextEncoder().encode(
      "<svg xmlns='http://www.w3.org/2000/svg' width='999' height='999'/>",
    );
    expect(await rejection(processImage(svg, IMAGE_PRESETS.logo))).toMatch(/JPEG, PNG or WebP/);
    expect(await rejection(processImage(new Uint8Array(), IMAGE_PRESETS.logo))).toMatch(/Empty/);
  });

  it("rejects files over 5 MB", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(await rejection(processImage(big, IMAGE_PRESETS.logo))).toMatch(/5 MB/);
  });

  it("rejects decompression bombs (tiny file, huge pixel count)", async () => {
    const bomb = await bytes(solid(10_000, 10_000).png({ compressionLevel: 9 }));
    expect(bomb.byteLength).toBeLessThan(MAX_UPLOAD_BYTES);
    expect(await rejection(processImage(bomb, IMAGE_PRESETS.cover))).toMatch(/could not be read/);
  });

  it("rejects truncated / corrupt images", async () => {
    const corrupt = (await bytes(solid(400, 400).jpeg())).slice(0, 200);
    await rejection(processImage(corrupt, IMAGE_PRESETS.logo));
  });
});
