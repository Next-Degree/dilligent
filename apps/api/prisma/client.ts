import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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

// Strategy:
// - Localhost: TLS off (typical dev Postgres has no cert).
// - Remote in explicit opt-out mode (PRISMA_ALLOW_INSECURE_TLS=1):
//   unverified TLS — used by Trigger.dev / Vercel envs that connect via
//   a tunneled proxy whose cert can't be pinned. Must be set deliberately;
//   the previous default ("just turn off verification") silently exposed
//   prod connections to MITM. (Cubic finding #1 on PR #2671.) Checked
//   *before* hasCABundle so this explicit override always wins — it used
//   to be checked second, which meant setting NODE_EXTRA_CA_CERTS to any
//   truthy value (even a bundle that doesn't actually validate) silently
//   ignored PRISMA_ALLOW_INSECURE_TLS=1 and kept failing.
// - Remote with NODE_EXTRA_CA_CERTS set: verified TLS using that bundle
//   (e.g. Docker with the RDS CA bundle baked in).
// - Remote with neither: throw at boot — surface the misconfig instead of
//   silently downgrading.
export function resolveSslConfig(
  databaseUrl: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): SslConfig {
  if (isLocalhostUrl(databaseUrl)) return undefined;
  if (env.PRISMA_ALLOW_INSECURE_TLS === '1') return { rejectUnauthorized: false };
  if (env.NODE_EXTRA_CA_CERTS) {
    // Verified TLS: rely on Node's TLS context (NODE_EXTRA_CA_CERTS adds the AWS
    // RDS CA to the trust store). Skip hostname check because connections may
    // traverse an AWS NLB whose hostname isn't in the RDS Proxy cert's SAN list.
    // The chain check still rejects forged or wrong-CA certs.
    return { checkServerIdentity: () => undefined };
  }
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
