/**
 * TLS configuration for the Postgres connection.
 *
 * Split out of client.ts so it can be unit tested without importing the
 * generated Prisma client.
 */

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export type SslConfig =
  | undefined
  | { ca: string }
  | { checkServerIdentity: () => undefined }
  | { rejectUnauthorized: false };

export function isLocalhostUrl(connectionString: string): boolean {
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

/**
 * Resolve the `ssl` option passed to node-postgres, in precedence order:
 *
 * - Localhost: TLS off (typical dev Postgres has no cert).
 * - DATABASE_CA_CERT: verified TLS against that CA. Needed for providers whose
 *   server cert chains to their own CA rather than a public root — Supabase and
 *   most self-hosted Postgres — where verification against the default trust
 *   store fails with "self-signed certificate in certificate chain".
 * - PRISMA_ALLOW_INSECURE_TLS=1: encrypted but unverified. Explicit opt-out for
 *   envs that connect through a tunnel/proxy whose cert can't be pinned.
 * - NODE_EXTRA_CA_CERTS: verified TLS via Node's trust store, which that
 *   variable extends (e.g. the AWS RDS bundle baked into the API image).
 * - None of the above: throw, so a misconfig surfaces instead of silently
 *   downgrading the connection.
 *
 * The opt-out is checked *before* NODE_EXTRA_CA_CERTS because
 * apps/api/Dockerfile.multistage always sets that variable. Checking the bundle
 * first would make PRISMA_ALLOW_INSECURE_TLS — the escape hatch the error below
 * tells you to use — impossible to reach inside the container.
 */
export function resolveSslConfig(
  databaseUrl: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): SslConfig {
  if (isLocalhostUrl(databaseUrl)) return undefined;

  // A PEM pasted into an env var: platforms differ on whether they keep real
  // newlines, so accept the \n-escaped form too.
  const caCert = env.DATABASE_CA_CERT?.trim().replace(/\\n/g, '\n');
  if (caCert) return { ca: caCert };

  if (env.PRISMA_ALLOW_INSECURE_TLS === '1') return { rejectUnauthorized: false };

  if (env.NODE_EXTRA_CA_CERTS) {
    // Hostname check is skipped because connections may traverse an AWS NLB
    // whose hostname isn't in the RDS Proxy cert's SAN list. The chain check
    // still rejects forged or wrong-CA certs.
    return { checkServerIdentity: () => undefined };
  }

  throw new Error(
    'Refusing to connect to a non-local Postgres without TLS verification. ' +
      'Set DATABASE_CA_CERT to your database provider CA certificate (PEM), ' +
      'or NODE_EXTRA_CA_CERTS to a CA bundle path, ' +
      'or PRISMA_ALLOW_INSECURE_TLS=1 if you intentionally want unverified TLS.',
  );
}
