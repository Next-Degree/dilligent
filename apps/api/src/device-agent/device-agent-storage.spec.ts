import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createDeviceAgentStorage } from './device-agent-storage';

describe('device-agent Neon storage', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      APP_AWS_ENDPOINT: 'https://branch.storage.example.com',
      APP_AWS_REGION: 'us-east-2',
      APP_AWS_ACCESS_KEY_ID: 'neon-key',
      APP_AWS_SECRET_ACCESS_KEY: 'neon-secret',
      APP_AWS_BUCKET_NAME: 'unrelated-app-bucket',
      FLEET_AGENT_BUCKET_NAME: 'agent-releases',
      FLEET_DEVICE_S3_ENV: 'staging',
    };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it.each([GetObjectCommand, HeadObjectCommand])(
    'presigns downloads at the app storage endpoint in the agent bucket',
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
    'APP_AWS_ENDPOINT',
    'APP_AWS_REGION',
    'APP_AWS_ACCESS_KEY_ID',
    'APP_AWS_SECRET_ACCESS_KEY',
    'FLEET_AGENT_BUCKET_NAME',
  ])('rejects missing %s', (name) => {
    delete process.env[name];
    expect(createDeviceAgentStorage).toThrow(name);
  });

  it('defaults the release channel to production in the Railway production environment', () => {
    delete process.env.FLEET_DEVICE_S3_ENV;
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    const { client, environment } = createDeviceAgentStorage();
    expect(environment).toBe('production');
    client.destroy();
  });

  it.each(['staging', undefined])(
    'requires the release channel when the Railway environment is %p',
    (railwayEnvironment) => {
      delete process.env.FLEET_DEVICE_S3_ENV;
      if (railwayEnvironment) {
        process.env.RAILWAY_ENVIRONMENT_NAME = railwayEnvironment;
      } else {
        delete process.env.RAILWAY_ENVIRONMENT_NAME;
      }
      expect(createDeviceAgentStorage).toThrow('FLEET_DEVICE_S3_ENV');
    },
  );

  it('rejects an invalid environment', () => {
    process.env.FLEET_DEVICE_S3_ENV = 'preview';
    expect(createDeviceAgentStorage).toThrow('FLEET_DEVICE_S3_ENV');
  });

  it('rejects a non-HTTPS endpoint', () => {
    process.env.APP_AWS_ENDPOINT = 'http://branch.storage.example.com';
    expect(createDeviceAgentStorage).toThrow('APP_AWS_ENDPOINT');
  });
});
