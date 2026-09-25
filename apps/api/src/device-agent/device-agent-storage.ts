import { S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { z } from 'zod';

const storageSchema = z.object({
  APP_AWS_ENDPOINT: z
    .string()
    .url()
    .refine((endpoint) => endpoint.startsWith('https://'), {
      message: 'must use HTTPS',
    }),
  APP_AWS_REGION: z.string().trim().min(1),
  APP_AWS_ACCESS_KEY_ID: z.string().trim().min(1),
  APP_AWS_SECRET_ACCESS_KEY: z.string().trim().min(1),
  FLEET_AGENT_BUCKET_NAME: z.string().trim().min(1),
  FLEET_DEVICE_S3_ENV: z.enum(['staging', 'production']).default('production'),
});

/** Reuses the app storage credentials; releases live in their own bucket. */
export function createDeviceAgentStorage() {
  const result = storageSchema.safeParse({
    ...process.env,
    // Treat an empty value as unset so the default applies.
    FLEET_DEVICE_S3_ENV: process.env.FLEET_DEVICE_S3_ENV || undefined,
  });
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Device agent storage misconfigured: ${fields.join(', ')}`);
  }
  const config = result.data;
  if (!process.env.FLEET_DEVICE_S3_ENV) {
    new Logger('DeviceAgentStorage').warn(
      'FLEET_DEVICE_S3_ENV is not set; serving production device agent releases',
    );
  }
  return {
    bucket: config.FLEET_AGENT_BUCKET_NAME,
    environment: config.FLEET_DEVICE_S3_ENV,
    client: new S3Client({
      endpoint: config.APP_AWS_ENDPOINT,
      region: config.APP_AWS_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.APP_AWS_ACCESS_KEY_ID,
        secretAccessKey: config.APP_AWS_SECRET_ACCESS_KEY,
      },
    }),
  };
}
