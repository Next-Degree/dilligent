import { resolveSslConfig } from '../prisma/client';

const REMOTE_URL = 'postgresql://u:p@db.prod.example.com:5432/x';
const CA_PATH = '/app/certs/prod-ca-2021.crt';
const fileFound = () => true;
const fileMissing = () => false;

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
      resolveSslConfig(REMOTE_URL, {
        PRISMA_ALLOW_INSECURE_TLS: '1',
        NODE_EXTRA_CA_CERTS: CA_PATH,
      }),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('takes the insecure opt-out before checking that the CA bundle exists', () => {
    expect(
      resolveSslConfig(
        REMOTE_URL,
        { PRISMA_ALLOW_INSECURE_TLS: '1', NODE_EXTRA_CA_CERTS: CA_PATH },
        fileMissing,
      ),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('returns checkServerIdentity-noop when NODE_EXTRA_CA_CERTS points at a file that exists', () => {
    expect(resolveSslConfig(REMOTE_URL, { NODE_EXTRA_CA_CERTS: CA_PATH }, fileFound)).toEqual({
      checkServerIdentity: expect.any(Function),
    });
  });

  it('throws when NODE_EXTRA_CA_CERTS points at a path that does not exist', () => {
    // Node silently ignores an unreadable NODE_EXTRA_CA_CERTS at startup, so without
    // this guard a typo'd path surfaces later as an opaque TLS chain error.
    expect(() =>
      resolveSslConfig(REMOTE_URL, { NODE_EXTRA_CA_CERTS: CA_PATH }, fileMissing),
    ).toThrow(/does not exist/);
  });

  it('throws for remote URLs with neither NODE_EXTRA_CA_CERTS nor PRISMA_ALLOW_INSECURE_TLS', () => {
    expect(() => resolveSslConfig(REMOTE_URL, {})).toThrow(/Refusing to connect/);
  });
});
