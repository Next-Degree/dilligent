// @vitest-environment node
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  storage: vi.fn(),
}));
vi.mock('@/utils/logger', () => ({ logger: vi.fn() }));
vi.mock('@trycompai/kv', () => ({ client: { get: mocks.get, del: mocks.del } }));
vi.mock('@/utils/device-agent-storage', () => ({ getDeviceAgentStorage: mocks.storage }));

describe('Neon installer downloads', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    vi.stubEnv('DEVICE_AGENT_S3_ENV', 'staging');
    mocks.get.mockResolvedValue({ os: 'windows' });
    mocks.storage.mockReturnValue({
      bucket: 'neon-agent-bucket',
      environment: 'staging',
      client: { send: mocks.send },
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  const request = () =>
    new NextRequest('https://portal.example.com/api/download-agent?token=valid');

  it.each([
    ['macos', 'macos/latest-arm64.dmg'],
    ['macos-intel', 'macos/latest-x64.dmg'],
    ['windows', 'windows/latest-setup.exe'],
    ['linux', 'linux/latest-amd64.deb'],
  ])('streams %s from the configured Neon bucket and consumes the token', async (os, key) => {
    mocks.get.mockResolvedValue({ os });
    mocks.send.mockResolvedValue({
      Body: Readable.from([Buffer.from('installer')]),
      ContentLength: 9,
    });
    const { GET } = await import('./route');
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('installer');
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'neon-agent-bucket',
      Key: `device-agent/staging/${key}`,
    });
    expect(mocks.del).toHaveBeenCalledWith('download:valid');
  });

  it('HEAD reads metadata without consuming the download token', async () => {
    mocks.send.mockResolvedValue({ ContentLength: 123 });
    const { HEAD } = await import('./route');
    const response = await HEAD(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Length')).toBe('123');
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens before accessing storage', async () => {
    mocks.get.mockResolvedValue(null);
    const { GET } = await import('./route');
    expect((await GET(request())).status).toBe(403);
    expect(mocks.storage).not.toHaveBeenCalled();
  });

  it('returns a configuration error without consuming the token', async () => {
    mocks.storage.mockImplementation(() => {
      throw new Error('missing Neon endpoint');
    });
    const { GET } = await import('./route');
    expect((await GET(request())).status).toBe(500);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('preserves the token when the storage download fails', async () => {
    mocks.send.mockRejectedValue(new Error('unavailable'));
    const { GET } = await import('./route');
    expect((await GET(request())).status).toBe(500);
    expect(mocks.del).not.toHaveBeenCalled();
  });
});
