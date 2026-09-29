import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRewritePath } from './host-routing';

const resolveDomain = vi.fn();

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('getRewritePath', () => {
  it('does not rewrite the platform host', async () => {
    const result = await getRewritePath({
      host: 'localhost:3008',
      pathname: '/acme',
      resolveDomain,
    });
    expect(result).toBeNull();
    expect(resolveDomain).not.toHaveBeenCalled();
  });

  it('rewrites the root of a custom domain to its portal', async () => {
    resolveDomain.mockResolvedValue('acme');
    const result = await getRewritePath({
      host: 'security.acme.com',
      pathname: '/',
      resolveDomain,
    });
    expect(result).toBe('/acme');
    expect(resolveDomain).toHaveBeenCalledWith('security.acme.com');
  });

  it('keeps nested paths such as the gated access page', async () => {
    resolveDomain.mockResolvedValue('acme');
    const result = await getRewritePath({
      host: 'security.acme.com',
      pathname: '/access/tok_1',
      resolveDomain,
    });
    expect(result).toBe('/acme/access/tok_1');
  });

  it.each(['/nda/tok_1', '/api/trust/acme/requests', '/_next/data/x.json'])(
    'leaves shared route %s alone',
    async (pathname) => {
      const result = await getRewritePath({
        host: 'security.acme.com',
        pathname,
        resolveDomain,
      });
      expect(result).toBeNull();
      expect(resolveDomain).not.toHaveBeenCalled();
    },
  );

  it('returns null for an unknown domain', async () => {
    resolveDomain.mockResolvedValue(null);
    const result = await getRewritePath({
      host: 'unknown.example.com',
      pathname: '/',
      resolveDomain,
    });
    expect(result).toBeNull();
  });

  it('honours TRUST_PLATFORM_HOSTS', async () => {
    vi.stubEnv('TRUST_PLATFORM_HOSTS', 'trust.dilligent.dev');
    const result = await getRewritePath({
      host: 'trust.dilligent.dev',
      pathname: '/acme',
      resolveDomain,
    });
    expect(result).toBeNull();
  });
});
