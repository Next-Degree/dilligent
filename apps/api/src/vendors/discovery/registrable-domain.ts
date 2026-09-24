/**
 * Multi-label public suffixes common enough to matter for vendor domains.
 *
 * Not the full Public Suffix List — pulling that in for domain comparison would be a large
 * dependency updated on its own schedule. These cover the cases that actually appear: without
 * them "example.co.uk" reduces to "co.uk", and two unrelated UK vendors compare equal.
 *
 * A suffix missing from this list degrades to comparing one label too few, which can only
 * cause a *missed* match, never a wrong one — the safe direction.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'net.uk',
  'sch.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'co.za',
  'org.za',
  'co.jp',
  'or.jp',
  'ne.jp',
  'ac.jp',
  'go.jp',
  'com.br',
  'net.br',
  'org.br',
  'com.mx',
  'com.ar',
  'com.sg',
  'com.hk',
  'com.tw',
  'co.kr',
  'co.in',
  'net.in',
  'org.in',
  'com.cn',
  'net.cn',
  'org.cn',
  'com.tr',
  'co.il',
  'com.pl',
]);

/**
 * Reduce a hostname to the part a company actually registers, so subdomains of one vendor
 * compare equal: `app.slack.com`, `www.slack.com` and `slack.com` all yield `slack.com`.
 *
 * Returns null for anything that is not a usable hostname — an IP address, a bare label with
 * no dot, or an unparseable string. Callers must treat null as "no domain evidence" rather
 * than matching nulls against each other.
 */
export function registrableDomain(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  if (!trimmed) return null;

  let hostname: string;
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    hostname = new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (!hostname || hostname.endsWith('.')) {
    hostname = hostname.replace(/\.+$/, '');
  }
  if (!hostname) return null;

  // An IP address identifies a host, not a company — never a vendor identity.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) {
    return null;
  }

  const labels = hostname.split('.').filter(Boolean);
  if (labels.length < 2) {
    return null;
  }

  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    if (labels.length < 3) {
      // The hostname *is* the public suffix — no registrable name in it.
      return null;
    }
    return labels.slice(-3).join('.');
  }

  return lastTwo;
}
