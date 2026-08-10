// Tests ../../prisma/ssl-config. The spec lives under src/ because jest is
// configured with rootDir: "src", so specs outside it are never discovered.
import { resolveSslConfig } from '../../prisma/ssl-config';

const REMOTE = 'postgresql://user:pass@db.example.supabase.co:5432/postgres';
const LOCAL = 'postgresql://postgres:postgres@127.0.0.1:5432/comp';
const PEM = '-----BEGIN CERTIFICATE-----\nMIIBogIC\n-----END CERTIFICATE-----';

describe('resolveSslConfig', () => {
  it('should disable TLS for localhost', () => {
    expect(resolveSslConfig(LOCAL, {})).toBeUndefined();
    expect(
      resolveSslConfig('postgresql://u:p@localhost:5432/db', {}),
    ).toBeUndefined();
  });

  it('should verify against DATABASE_CA_CERT when provided', () => {
    expect(resolveSslConfig(REMOTE, { DATABASE_CA_CERT: PEM })).toEqual({
      ca: PEM,
    });
  });

  it('should accept a CA cert with escaped newlines', () => {
    const escaped =
      '-----BEGIN CERTIFICATE-----\\nMIIBogIC\\n-----END CERTIFICATE-----';

    expect(resolveSslConfig(REMOTE, { DATABASE_CA_CERT: escaped })).toEqual({
      ca: PEM,
    });
  });

  it('should prefer the CA cert over the insecure opt-out', () => {
    expect(
      resolveSslConfig(REMOTE, {
        DATABASE_CA_CERT: PEM,
        PRISMA_ALLOW_INSECURE_TLS: '1',
      }),
    ).toEqual({ ca: PEM });
  });

  it('should ignore a blank CA cert and fall through', () => {
    expect(
      resolveSslConfig(REMOTE, {
        DATABASE_CA_CERT: '   ',
        PRISMA_ALLOW_INSECURE_TLS: '1',
      }),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('should let the explicit opt-out win over a baked-in NODE_EXTRA_CA_CERTS', () => {
    // The API image always sets NODE_EXTRA_CA_CERTS, so checking the bundle
    // first would make this opt-out unreachable inside the container.
    expect(
      resolveSslConfig(REMOTE, {
        PRISMA_ALLOW_INSECURE_TLS: '1',
        NODE_EXTRA_CA_CERTS: '/usr/local/share/aws-rds-ca-bundle.pem',
      }),
    ).toEqual({ rejectUnauthorized: false });
  });

  it('should verify via the trust store when only NODE_EXTRA_CA_CERTS is set', () => {
    const ssl = resolveSslConfig(REMOTE, {
      NODE_EXTRA_CA_CERTS: '/usr/local/share/aws-rds-ca-bundle.pem',
    });

    expect(ssl).toHaveProperty('checkServerIdentity');
  });

  it('should throw for a remote database with no TLS configuration', () => {
    expect(() => resolveSslConfig(REMOTE, {})).toThrow(
      /Refusing to connect to a non-local Postgres/,
    );
  });

  it('should treat a malformed URL as remote rather than dropping TLS', () => {
    expect(() => resolveSslConfig('not-a-url', {})).toThrow(
      /Refusing to connect to a non-local Postgres/,
    );
  });

  it('should only accept "1" as the opt-out value', () => {
    expect(() =>
      resolveSslConfig(REMOTE, { PRISMA_ALLOW_INSECURE_TLS: 'true' }),
    ).toThrow(/Refusing to connect to a non-local Postgres/);
  });
});
