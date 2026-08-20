/**
 * Fallback logo.dev token.
 *
 * logo.dev publishable keys are designed to be visible in client requests, so this is not a
 * secret — but it is deployment configuration, and hardcoding it means a self-hosted
 * instance silently renders someone else's account's logos and burns their quota.
 * `LOGO_DEV_TOKEN` overrides it.
 */
const DEFAULT_LOGO_DEV_TOKEN = 'pk_X-1ZO13GSgeOoUrIuJ6GMQ';

/** Hostname of a vendor website, or null when there is nothing usable to derive one from. */
export function vendorDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const domain = website
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  return domain || null;
}

/**
 * Logo for a vendor: whatever was stored, else one derived from the vendor's domain.
 * Returns null when neither is available, so callers render their own placeholder rather
 * than a broken image.
 */
export function vendorLogoUrl({
  logoUrl,
  website,
}: {
  logoUrl: string | null | undefined;
  website: string | null | undefined;
}): string | null {
  if (logoUrl) return logoUrl;

  const domain = vendorDomain(website);
  if (!domain) return null;

  const token = process.env.LOGO_DEV_TOKEN || DEFAULT_LOGO_DEV_TOKEN;
  return `https://img.logo.dev/${domain}?token=${token}&size=64`;
}
