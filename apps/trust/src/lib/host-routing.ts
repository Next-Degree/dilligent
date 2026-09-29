import { isPlatformHost, stripPort } from './env';

/** Paths that exist at the root of every host and must never be rewritten. */
const PASSTHROUGH_PREFIXES = ['/api/', '/nda/', '/_next/'];

export type ResolveDomain = (domain: string) => Promise<string | null>;

/**
 * Decides whether a request on a custom domain must be rewritten to the
 * owning portal's path. Returns null when no rewrite is needed (platform host,
 * shared route, or unknown domain).
 */
export async function getRewritePath(params: {
  host: string;
  pathname: string;
  resolveDomain: ResolveDomain;
}): Promise<string | null> {
  const { host, pathname, resolveDomain } = params;

  if (!host || isPlatformHost(host)) return null;
  if (PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  const friendlyUrl = await resolveDomain(stripPort(host));
  if (!friendlyUrl) return null;

  return pathname === '/' ? `/${friendlyUrl}` : `/${friendlyUrl}${pathname}`;
}
