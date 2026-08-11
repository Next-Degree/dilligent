import { resolveSslConfig } from '../prisma/client';

describe('resolveSslConfig', () => {
  it('returns undefined for localhost', () => {
    expect(resolveSslConfig('postgresql://u:p@localhost:5432/x', {})).toBeUndefined();
  });

  it('returns undefined for 127.0.0.1', () => {
    expect(resolveSslConfig('postgresql://u:p@127.0.0.1:5432/x', {})).toBeUndefined();
  });

  it('returns undefined for ::1', () => {
    expect(resolveSslConfig('postgresql://u:p@[::1]:5432/x', {})).toBeUndefined();
  });

  it('returns rejectUnauthorized:false when PRISMA_ALLOW_INSECURE_TLS=1, even with NODE_EXTRA_CA_CERTS set', () => {
    // Regression test: PRISMA_ALLOW_INSECURE_TLS must win over a CA bundle
    // that's present but not actually trusted — this was silently ignored
    // when the CA-bundle branch was checked first.
    expect(
      resolveSslConfig('postgresql://u:p@db.prod.example.com:5432/x', {
        PRISMA_ALLOW_INSECURE_TLS: '1',
        NODE_EXTRA_CA_CERTS: '/app/certs/prod-ca-2021.crt',
      }),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('returns checkServerIdentity-noop when NODE_EXTRA_CA_CERTS is set without the insecure opt-out', () => {
    const result = resolveSslConfig('postgresql://u:p@db.prod.example.com:5432/x', {
      NODE_EXTRA_CA_CERTS: '/app/certs/prod-ca-2021.crt',
    });
    expect(result).toBeDefined();
    expect(typeof (result as { checkServerIdentity: unknown }).checkServerIdentity).toBe('function');
    expect((result as { checkServerIdentity: () => undefined }).checkServerIdentity()).toBeUndefined();
  });

  it('throws for remote URLs with neither NODE_EXTRA_CA_CERTS nor PRISMA_ALLOW_INSECURE_TLS', () => {
    expect(() => resolveSslConfig('postgresql://u:p@db.prod.example.com:5432/x', {})).toThrow(
      /Refusing to connect/,
    );
  });
});
