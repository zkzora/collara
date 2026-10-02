// Private object storage for evidence (SeaweedFS locally, any S3-compatible store elsewhere).
// Buckets are private; bytes leave only through 60-second presigned GET URLs issued after an access check.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Config } from "../config";

export interface PresignOptions {
  readonly expiresInSeconds: number;
  /** Suggested download file name (Content-Disposition: attachment). */
  readonly fileName: string;
  readonly contentType: string;
}

export interface StorageService {
  readonly bucket: string;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Streams an object's bytes (callers enforce their own size cap). */
  getObject(key: string): Promise<AsyncIterable<Uint8Array>>;
  deleteObject(key: string): Promise<void>;
  presignGet(key: string, options: PresignOptions): Promise<string>;
  check(): Promise<{ ok: boolean; detail: string }>;
}

/** Content-Disposition with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createS3Storage(config: Config): StorageService | null {
  if (!config.COLLARA_S3_ENDPOINT || !config.COLLARA_S3_ACCESS_KEY || !config.COLLARA_S3_SECRET_KEY) return null;
  const base = {
    region: config.COLLARA_S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: config.COLLARA_S3_ACCESS_KEY, secretAccessKey: config.COLLARA_S3_SECRET_KEY },
    // SeaweedFS (and other S3-compatibles) reject the SDK's default flexible checksums.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  } as const;
  const client = new S3Client({ ...base, endpoint: config.COLLARA_S3_ENDPOINT });
  const presignClient = config.COLLARA_S3_PUBLIC_ENDPOINT ? new S3Client({ ...base, endpoint: config.COLLARA_S3_PUBLIC_ENDPOINT }) : client;
  const bucket = config.COLLARA_S3_BUCKET;

  return {
    bucket,
    async putObject(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
    },
    async getObject(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = response.Body;
      if (!body || !(Symbol.asyncIterator in body)) throw new Error(`object ${key} has no readable body`);
      return body as AsyncIterable<Uint8Array>;
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    presignGet(key, options) {
      return getSignedUrl(
        presignClient,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: attachmentDisposition(options.fileName),
          ResponseContentType: options.contentType,
        }),
        { expiresIn: options.expiresInSeconds },
      );
    },
    async check() {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(3_000) });
        return { ok: true, detail: "Private bucket reachable." };
      } catch {
        return { ok: false, detail: "Object storage is not reachable." };
      }
    },
  };
}

/** In-memory storage for tests and local experiments (never used when S3 is configured). */
export function createMemoryStorage(bucket = "collara-evidence-memory"): StorageService & { readonly objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    bucket,
    objects,
    async putObject(key, body, contentType) {
      objects.set(key, { body: new Uint8Array(body), contentType });
    },
    async getObject(key) {
      const object = objects.get(key);
      if (!object) throw new Error(`object ${key} not found`);
      return (async function* () {
        yield object.body;
      })();
    },
    async deleteObject(key) {
      objects.delete(key);
    },
    async presignGet(key, options) {
      if (!objects.has(key)) throw new Error(`object ${key} not found`);
      const expires = Date.now() + options.expiresInSeconds * 1000;
      return `memory://${bucket}/${encodeURIComponent(key)}?expires=${expires}`;
    },
    async check() {
      return { ok: true, detail: "In-memory storage (tests only)." };
    },
  };
}
