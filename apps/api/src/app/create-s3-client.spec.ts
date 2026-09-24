const s3ClientCtor = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn((config: unknown) => {
    s3ClientCtor(config);
    return {};
  }),
}));

import { createS3Client } from './create-s3-client';

const ENV_KEYS = [
  'APP_AWS_ACCESS_KEY_ID',
  'APP_AWS_SECRET_ACCESS_KEY',
  'APP_AWS_REGION',
  'APP_AWS_ENDPOINT',
] as const;

describe('createS3Client', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    s3ClientCtor.mockClear();
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.APP_AWS_ACCESS_KEY_ID = 'key';
    process.env.APP_AWS_SECRET_ACCESS_KEY = 'secret';
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('targets AWS with the default region when no endpoint is set', () => {
    createS3Client();

    expect(s3ClientCtor).toHaveBeenCalledWith({
      region: 'us-east-1',
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
    });
  });

  it('uses the custom endpoint with path-style addressing when APP_AWS_ENDPOINT is set', () => {
    process.env.APP_AWS_REGION = 'eu-west-1';
    process.env.APP_AWS_ENDPOINT = 'http://minio:9000';

    createS3Client();

    expect(s3ClientCtor).toHaveBeenCalledWith({
      region: 'eu-west-1',
      credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
    });
  });

  it('ignores an empty APP_AWS_ENDPOINT', () => {
    process.env.APP_AWS_ENDPOINT = '';

    createS3Client();

    expect(s3ClientCtor.mock.calls[0][0]).not.toHaveProperty('endpoint');
  });

  it('throws when credentials are missing', () => {
    delete process.env.APP_AWS_SECRET_ACCESS_KEY;

    expect(() => createS3Client()).toThrow(/credentials are missing/);
  });
});
