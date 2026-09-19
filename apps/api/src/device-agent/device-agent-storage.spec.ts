import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createDeviceAgentStorage } from './device-agent-storage';

describe('device-agent Neon storage', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DEVICE_AGENT_S3_ENDPOINT: 'https://branch.storage.example.com',
      DEVICE_AGENT_S3_REGION: 'us-east-2',
      DEVICE_AGENT_S3_BUCKET: 'agent-releases',
      DEVICE_AGENT_S3_ACCESS_KEY_ID: 'neon-key',
      DEVICE_AGENT_S3_SECRET_ACCESS_KEY: 'neon-secret',
      DEVICE_AGENT_S3_ENV: 'staging',
      APP_AWS_ACCESS_KEY_ID: 'unrelated-aws-key',
      APP_AWS_SECRET_ACCESS_KEY: 'unrelated-aws-secret',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it.each([GetObjectCommand, HeadObjectCommand])(
    'presigns downloads at the Neon endpoint with path-style bucket addressing',
    async (Command) => {
      const { client, bucket, environment } = createDeviceAgentStorage();
      expect(environment).toBe('staging');
      const key = 'device-agent/staging/updates/agent.zip';
      const signed = new URL(
        await getSignedUrl(client, new Command({ Bucket: bucket, Key: key }), {
          expiresIn: 3600,
        }),
      );
      expect(signed.origin).toBe('https://branch.storage.example.com');
      expect(signed.pathname).toBe(`/agent-releases/${key}`);
      expect(signed.searchParams.get('X-Amz-Credential')).toMatch(
        /^neon-key\/.*\/us-east-2\/s3\/aws4_request$/,
      );
      expect(signed.searchParams.get('X-Amz-Expires')).toBe('3600');
      client.destroy();
    },
  );

  it.each([
    'ENDPOINT',
    'REGION',
    'BUCKET',
    'ACCESS_KEY_ID',
    'SECRET_ACCESS_KEY',
    'ENV',
  ])('rejects missing %s without falling back to AWS', (suffix) => {
    delete process.env[`DEVICE_AGENT_S3_${suffix}`];
    expect(createDeviceAgentStorage).toThrow(`DEVICE_AGENT_S3_${suffix}`);
  });

  it('rejects an invalid environment', () => {
    process.env.DEVICE_AGENT_S3_ENV = 'preview';
    expect(createDeviceAgentStorage).toThrow('DEVICE_AGENT_S3_ENV');
  });

  it('rejects a non-HTTPS endpoint', () => {
    process.env.DEVICE_AGENT_S3_ENDPOINT = 'http://branch.storage.example.com';
    expect(createDeviceAgentStorage).toThrow('DEVICE_AGENT_S3_ENDPOINT');
  });
});
