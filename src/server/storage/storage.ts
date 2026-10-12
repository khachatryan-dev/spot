import "server-only";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { env } from "@/shared/config/env";

/** Object storage for uploads (§31). S3-compatible: Cloudflare R2, AWS S3, MinIO. */
export interface Storage {
  put(
    key: string,
    body: Uint8Array,
    options: { contentType: string; cacheControl?: string },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

let storage: Storage | null | undefined;

/** The configured storage, or null when uploads aren't set up in this environment. */
export function getStorage(): Storage | null {
  if (storage !== undefined) return storage;
  const { STORAGE_ENDPOINT, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_BUCKET } = env;
  if (!STORAGE_ENDPOINT || !STORAGE_ACCESS_KEY || !STORAGE_SECRET_KEY || !STORAGE_BUCKET) {
    storage = null;
    return storage;
  }

  const client = new S3Client({
    endpoint: STORAGE_ENDPOINT,
    region: env.STORAGE_REGION ?? "auto",
    credentials: { accessKeyId: STORAGE_ACCESS_KEY, secretAccessKey: STORAGE_SECRET_KEY },
    // MinIO and many S3-compatible services need path-style URLs.
    forcePathStyle: true,
  });

  storage = {
    async put(key, body, { contentType, cacheControl }) {
      await client.send(
        new PutObjectCommand({
          Bucket: STORAGE_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
        }),
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: key }));
    },
  };
  return storage;
}
