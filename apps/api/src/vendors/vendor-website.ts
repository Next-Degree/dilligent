/**
 * Website and domain normalization shared by vendor creation and vendor discovery.
 *
 * Relocated verbatim from `vendors.service.ts` so discovery can reuse the exact rules the
 * register already applies — a second implementation would drift and produce vendors that
 * look like duplicates of ones already present.
 */

export const normalizeWebsite = (
  website: string | null | undefined,
): string | null => {
  if (!website) return null;
  const trimmed = website.trim();
  if (!trimmed) return null;

  // Require explicit protocol (do not silently force https)
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const port = url.port ? `:${url.port}` : '';
    return `${protocol}//${hostname}${port}`;
  } catch {
    return null;
  }
};

/**
 * Extract domain from website URL for GlobalVendors lookup.
 * Removes www. prefix and returns just the domain (e.g., "example.com").
 */
export const extractDomain = (
  website: string | null | undefined,
): string | null => {
  if (!website) return null;

  const trimmed = website.trim();
  if (!trimmed) return null;

  try {
    // Add protocol if missing to make URL parsing work
    const urlString = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(urlString);
    // Remove www. prefix and return just the domain
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};
