import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { existsSync } from 'node:fs';

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

function stripSslMode(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return url.toString();
}

function isLocalhostUrl(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString);
    // Strip square brackets from IPv6 host form (e.g. [::1] → ::1)
    const stripped = hostname.replace(/^\[/, '').replace(/\]$/, '');
    return LOCAL_HOSTNAMES.has(stripped);
  } catch {
    // Malformed URL — be conservative and treat as remote so we don't
    // accidentally disable TLS verification.
    return false;
  }
}

export type SslConfig =
  | undefined
  | { checkServerIdentity: () => undefined }
  | { rejectUnauthorized: false };

// Order matters: the explicit PRISMA_ALLOW_INSECURE_TLS opt-out is checked before
// NODE_EXTRA_CA_CERTS so it always wins over a present-but-untrusted CA bundle
// (see prisma-client-ssl.spec.ts). The opt-out must be deliberate — defaulting to
// unverified TLS silently exposed prod connections to MITM (Cubic finding #1 on PR #2671).
export function resolveSslConfig(
  databaseUrl: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  fileExists: (path: string) => boolean = existsSync,
): SslConfig {
  // Localhost: TLS off — a typical dev Postgres has no cert.
  if (isLocalhostUrl(databaseUrl)) return undefined;
  // Explicit opt-out: unverified TLS, for envs reaching Postgres through a
  // tunnelled proxy whose cert can't be pinned.
  if (env.PRISMA_ALLOW_INSECURE_TLS === '1') return { rejectUnauthorized: false };
  if (env.NODE_EXTRA_CA_CERTS) {
    // Node reads NODE_EXTRA_CA_CERTS once at startup and silently ignores a path that
    // doesn't exist. Without this check a bad path still selects strict chain
    // verification against a store that never loaded the cert, surfacing much later as
    // an opaque "self-signed certificate in certificate chain" with nothing naming the
    // env var as the cause.
    if (!fileExists(env.NODE_EXTRA_CA_CERTS)) {
      throw new Error(
        `NODE_EXTRA_CA_CERTS points at ${env.NODE_EXTRA_CA_CERTS}, which does not exist. ` +
          'Node ignored it at startup, so TLS verification would fail with a misleading error. ' +
          'Fix the path, or set PRISMA_ALLOW_INSECURE_TLS=1 to opt out of verification.',
      );
    }
    // Verified TLS: the bundle is appended to Node's trust store. The hostname check is
    // skipped because connections reach Postgres via a pooler/proxy whose hostname isn't
    // in the cert's SAN list; chain validation still rejects forged or wrong-CA certs.
    return { checkServerIdentity: () => undefined };
  }
  // Neither set: fail at boot rather than silently downgrading.
  throw new Error(
    'Refusing to connect to a non-local Postgres without TLS verification. Set NODE_EXTRA_CA_CERTS to a CA bundle, or set PRISMA_ALLOW_INSECURE_TLS=1 if you intentionally want unverified TLS.',
  );
}

function createPrismaClient(): PrismaClient {
  const rawUrl = process.env.DATABASE_URL!;
  const ssl = resolveSslConfig(rawUrl);
  // Strip sslmode from the connection string to avoid conflicts with the explicit ssl option
  const url = ssl !== undefined ? stripSslMode(rawUrl) : rawUrl;
  const adapter = new PrismaPg({ connectionString: url, ssl });
  return new PrismaClient({
    adapter,
    transactionOptions: {
      timeout: 60000,
    },
  });
}

// Lazy initialization. Importing this module does NOT construct a Prisma client
// — that only happens on first property access on `db`. Critical so that
// Next.js `next build` (which imports every route handler to analyze it) does
// not trigger the strict TLS check at build time when no actual queries run.
function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
