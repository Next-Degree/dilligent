import { S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

const storageSchema = z.object({
  FLEET_DEVICE_S3_ENDPOINT_URL: z
    .string()
    .url()
    .refine((endpoint) => endpoint.startsWith('https://'), {
      message: 'must use HTTPS',
    }),
  FLEET_DEVICE_S3_REGION: z.string().trim().min(1),
  FLEET_DEVICE_S3_ACCESS_KEY_ID: z.string().trim().min(1),
  FLEET_DEVICE_S3_SECRET_ACCESS_KEY: z.string().trim().min(1),
  FLEET_DEVICE_S3_BUCKET: z.string().trim().min(1),
  FLEET_DEVICE_S3_ENV: z.enum(['staging', 'production']),
});

let storage:
  | {
      bucket: string;
      environment: 'staging' | 'production';
      client: S3Client;
    }
  | undefined;

/** Validate lazily so builds and unrelated portal routes need no storage secrets. */
export function getDeviceAgentStorage() {
  if (storage) return storage;
  const result = storageSchema.safeParse(process.env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Device agent storage misconfigured: ${fields.join(', ')}`);
  }
  const config = result.data;
  storage = {
    bucket: config.FLEET_DEVICE_S3_BUCKET,
    environment: config.FLEET_DEVICE_S3_ENV,
    client: new S3Client({
      endpoint: config.FLEET_DEVICE_S3_ENDPOINT_URL,
      region: config.FLEET_DEVICE_S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.FLEET_DEVICE_S3_ACCESS_KEY_ID,
        secretAccessKey: config.FLEET_DEVICE_S3_SECRET_ACCESS_KEY,
      },
    }),
  };
  return storage;
}
