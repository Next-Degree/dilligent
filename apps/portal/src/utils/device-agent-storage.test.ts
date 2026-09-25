// @vitest-environment node
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('portal device-agent storage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('APP_AWS_ENDPOINT', 'https://branch.storage.example.com');
    vi.stubEnv('APP_AWS_REGION', 'us-east-2');
    vi.stubEnv('FLEET_AGENT_BUCKET_NAME', 'agent-releases');
    vi.stubEnv('APP_AWS_ACCESS_KEY_ID', 'neon-key');
    vi.stubEnv('APP_AWS_SECRET_ACCESS_KEY', 'neon-secret');
    vi.stubEnv('FLEET_DEVICE_S3_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses the app storage credentials with the agent bucket and reuses the client', async () => {
    const { getDeviceAgentStorage } = await import('./device-agent-storage');
    const storage = getDeviceAgentStorage();
    expect(storage.environment).toBe('production');
    expect(getDeviceAgentStorage()).toBe(storage);
    const url = new URL(
      await getSignedUrl(
        storage.client,
        new GetObjectCommand({
          Bucket: storage.bucket,
          Key: 'device-agent/production/windows/latest-setup.exe',
        }),
      ),
    );
    expect(url.origin).toBe('https://branch.storage.example.com');
    expect(url.pathname).toBe('/agent-releases/device-agent/production/windows/latest-setup.exe');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^neon-key\//);
    storage.client.destroy();
  });

  it.each([
    'APP_AWS_ENDPOINT',
    'APP_AWS_REGION',
    'FLEET_AGENT_BUCKET_NAME',
    'APP_AWS_ACCESS_KEY_ID',
    'APP_AWS_SECRET_ACCESS_KEY',
  ])('validates missing %s on access, not import', async (name) => {
    vi.stubEnv(name, '');
    const { getDeviceAgentStorage } = await import('./device-agent-storage');
    expect(getDeviceAgentStorage).toThrow(name);
  });

  it('defaults the release channel to production when unset', async () => {
    vi.stubEnv('FLEET_DEVICE_S3_ENV', '');
    const { getDeviceAgentStorage } = await import('./device-agent-storage');
    expect(getDeviceAgentStorage().environment).toBe('production');
  });

  it('honours an explicit staging channel', async () => {
    vi.stubEnv('FLEET_DEVICE_S3_ENV', 'staging');
    const { getDeviceAgentStorage } = await import('./device-agent-storage');
    expect(getDeviceAgentStorage().environment).toBe('staging');
  });

  it('rejects an invalid environment', async () => {
    vi.stubEnv('FLEET_DEVICE_S3_ENV', 'preview');
    const { getDeviceAgentStorage } = await import('./device-agent-storage');
    expect(getDeviceAgentStorage).toThrow('FLEET_DEVICE_S3_ENV');
  });

  it('rejects a non-HTTPS endpoint', async () => {
    vi.stubEnv('APP_AWS_ENDPOINT', 'http://branch.storage.example.com');
    const { getDeviceAgentStorage } = await import('./device-agent-storage');
    expect(getDeviceAgentStorage).toThrow('APP_AWS_ENDPOINT');
  });
});
