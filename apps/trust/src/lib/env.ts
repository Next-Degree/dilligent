const DEFAULT_API_URL = 'http://localhost:3333';
const DEFAULT_PLATFORM_HOSTS = 'localhost,127.0.0.1';

export function getApiUrl(): string {
  const url = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
  return url.replace(/\/+$/, '');
}

/** Hostnames served path based (/<friendlyUrl>) instead of as a custom domain. */
export function getPlatformHosts(): string[] {
  return (process.env.TRUST_PLATFORM_HOSTS ?? DEFAULT_PLATFORM_HOSTS)
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function stripPort(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, '');
}

export function isPlatformHost(host: string): boolean {
  return getPlatformHosts().includes(stripPort(host));
}
