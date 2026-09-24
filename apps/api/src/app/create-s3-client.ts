import { S3Client } from '@aws-sdk/client-s3';

export function createS3Client(): S3Client {
  const accessKeyId = process.env.APP_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.APP_AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS S3 credentials are missing. Set APP_AWS_ACCESS_KEY_ID and APP_AWS_SECRET_ACCESS_KEY.',
    );
  }

  const endpoint = process.env.APP_AWS_ENDPOINT;

  return new S3Client({
    region: process.env.APP_AWS_REGION || 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}
