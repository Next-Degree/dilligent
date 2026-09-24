/**
 * logo.dev publishable keys are designed to be visible in client requests, so this is not a
 * secret — but it is deployment configuration, and hardcoding it means a self-hosted instance
 * silently renders someone else's account's logos and burns their quota.
 *
 * `LOGO_DEV_TOKEN` overrides the default for server code. Next.js only inlines env vars
 * prefixed `NEXT_PUBLIC_` into client bundles, so browser-rendered code needs
 * `NEXT_PUBLIC_LOGO_DEV_TOKEN` instead — set both to override everywhere.
 */
const DEFAULT_LOGO_DEV_TOKEN = 'pk_AZatYxV5QDSfWpRDaBxzRQ';

function resolveLogoDevToken(): string {
  // Guarded: this runs in browser bundles too, where `process` does not exist. The
  // NEXT_PUBLIC_ access below is safe unguarded — bundlers inline it to a literal (or
  // `undefined`) at build time, so no runtime `process` reference survives into the browser.
  const serverToken = typeof process !== 'undefined' ? process.env.LOGO_DEV_TOKEN : undefined;
  const publicToken = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;
  return serverToken || publicToken || DEFAULT_LOGO_DEV_TOKEN;
}

export interface LogoUrlOptions {
  /** Requests the PNG variant instead of logo.dev's default format. */
  format?: 'png';
  /** Requests a @2x-resolution image. */
  retina?: boolean;
  /** Pixel size of the square image. */
  size?: number;
}

/** logo.dev image URL for a domain (e.g. "github.com"), with the resolved token attached. */
export function logoUrl(domain: string, opts: LogoUrlOptions = {}): string {
  const params = new URLSearchParams({ token: resolveLogoDevToken() });
  if (opts.format) params.set('format', opts.format);
  if (opts.retina) params.set('retina', 'true');
  if (opts.size !== undefined) params.set('size', String(opts.size));
  return `https://img.logo.dev/${domain}?${params.toString()}`;
}
