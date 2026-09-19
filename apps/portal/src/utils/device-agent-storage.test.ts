// @vitest-environment node
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('portal device-agent storage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('DEVICE_AGENT_S3_ENDPOINT', 'https://branch.storage.example.com');
    vi.stubEnv('DEVICE_AGENT_S3_REGION', 'us-east-2');
    vi.stubEnv('DEVICE_AGENT_S3_BUCKET', 'agent-releases');
    vi.stubEnv('DEVICE_AGENT_S3_ACCESS_KEY_ID', 'neon-key');
    vi.stubEnv('DEVICE_AGENT_S3_SECRET_ACCESS_KEY', 'neon-secret');
    vi.stubEnv('DEVICE_AGENT_S3_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses dedicated Neon credentials and reuses the client', async () => {
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

  it.each(['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'ENV'])(
    'validates missing %s on access, not import',
    async (suffix) => {
      vi.stubEnv(`DEVICE_AGENT_S3_${suffix}`, '');
      const { getDeviceAgentStorage } = await import('./device-agent-storage');
      expect(getDeviceAgentStorage).toThrow(`DEVICE_AGENT_S3_${suffix}`);
    },
  );

  it('rejects an invalid environment', async () => {
    vi.stubEnv('DEVICE_AGENT_S3_ENV', 'preview');
    const { getDeviceAgentStorage } = await import('./device-agent-storage');
    expect(getDeviceAgentStorage).toThrow('DEVICE_AGENT_S3_ENV');
  });

  it('rejects a non-HTTPS endpoint', async () => {
    vi.stubEnv('DEVICE_AGENT_S3_ENDPOINT', 'http://branch.storage.example.com');
    const { getDeviceAgentStorage } = await import('./device-agent-storage');
    expect(getDeviceAgentStorage).toThrow('DEVICE_AGENT_S3_ENDPOINT');
  });
});
