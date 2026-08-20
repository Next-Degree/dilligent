/**
 * Deterministic vendor -> integration matching.
 *
 * A vendor row and an integration manifest are two views of the same third
 * party ("GitHub" the vendor, `github` the integration). Nothing in the schema
 * links them, so the link is DERIVED here from the vendor's name and website.
 *
 * The rules are intentionally conservative: only exact (normalized) equality on
 * a name, slug, curated alias, or website brand label counts. A false positive
 * would attribute another company's access list to a vendor, which is worse for
 * a compliance product than showing no integration at all.
 *
 * Pure functions only — no DB, no registry lookups. The service layer supplies
 * the manifests and the set of connected slugs.
 */

/** Why a vendor was matched to an integration, strongest first. */
export type VendorIntegrationMatchReason = 'slug' | 'name' | 'alias' | 'domain';

const MATCH_TIERS: readonly VendorIntegrationMatchReason[] = [
  'slug',
  'name',
  'alias',
  'domain',
];

export interface VendorIntegrationMatch {
  slug: string;
  matchedOn: VendorIntegrationMatchReason;
}

/** The manifest fields matching needs — keeps this module free of the registry. */
export interface MatchableManifest {
  id: string;
  name: string;
  baseUrl?: string;
  /** Other names customers call this integration, declared by the manifest. */
  aliases?: readonly string[];
}

/**
 * A manifest reduced to the labels matching compares against.
 *
 * Prepared once per catalog rather than once per vendor: nothing here depends
 * on the vendor, and the alternative re-parses every manifest's URL for every
 * vendor in the org.
 */
export interface PreparedManifest {
  /** The manifest's own id — what callers key connections by. */
  id: string;
  slug: string;
  name: string;
  aliases: ReadonlySet<string>;
  brand: string;
}

/**
 * Trailing words that describe what a company sells rather than who it is, so
 * "Aikido Security" and "Aikido" name the same vendor. Corporate suffixes are
 * included for the same reason ("Asana, Inc.").
 */
const TRAILING_DESCRIPTORS = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'corp',
  'corporation',
  'company',
  'co',
  'gmbh',
  'plc',
  'bv',
  'sa',
  'ag',
  'security',
  'software',
  'technologies',
  'technology',
  'labs',
  'io',
  'com',
]);

/** Subdomains that describe an endpoint, not the brand behind it. */
const GENERIC_SUBDOMAINS = new Set([
  'admin',
  'api',
  'api2',
  'apis',
  'app',
  'apps',
  'auth',
  'cloud',
  'console',
  'dashboard',
  'developer',
  'developers',
  'eu',
  'go',
  'login',
  'management',
  'my',
  'portal',
  'rest',
  'secure',
  'us',
  'v1',
  'v2',
  'www',
]);

/** Multi-label public suffixes we care about, so `foo.co.uk` yields `foo`. */
const SECOND_LEVEL_SUFFIXES = new Set([
  'co.uk',
  'com.au',
  'com.br',
  'com.mx',
  'co.in',
  'co.jp',
  'co.nz',
]);

/** Lowercase and drop everything that is not a letter or digit. */
export function normalizeLabel(value: string | null | undefined): string {
  if (!value) return '';
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * The name with trailing descriptor words removed ("Aikido Security" ->
 * "aikido"). Returns '' when nothing meaningful survives, so a vendor called
 * "Security" never matches every security tool.
 */
function normalizeCoreName(value: string | null | undefined): string {
  if (!value) return '';
  const tokens = words(value);
  while (
    tokens.length > 1 &&
    TRAILING_DESCRIPTORS.has(tokens[tokens.length - 1])
  ) {
    tokens.pop();
  }
  const core = tokens.join('');
  return core.length >= 3 ? core : '';
}

function hostnameOf(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * The brand label of a URL: the registrable domain's first label, with generic
 * endpoint subdomains dropped. `https://app.aikido.dev/api` -> `aikido`.
 */
export function brandLabelOf(url: string | null | undefined): string {
  const hostname = hostnameOf(url);
  if (!hostname) return '';

  const labels = hostname.split('.').filter(Boolean);
  while (labels.length > 2 && GENERIC_SUBDOMAINS.has(labels[0])) {
    labels.shift();
  }
  if (labels.length < 2) return normalizeLabel(labels[0]);

  const lastTwo = labels.slice(-2).join('.');
  const brandIndex = SECOND_LEVEL_SUFFIXES.has(lastTwo)
    ? labels.length - 3
    : labels.length - 2;
  if (brandIndex < 0) return '';

  const brand = normalizeLabel(labels[brandIndex]);
  return GENERIC_SUBDOMAINS.has(brand) ? '' : brand;
}

/** Reduce each manifest to the labels that identify it. Do this once. */
export function prepareManifests(
  manifests: readonly MatchableManifest[],
): PreparedManifest[] {
  return manifests.map((manifest) => {
    const name = normalizeLabel(manifest.name);

    const aliases = new Set<string>();
    const coreName = normalizeCoreName(manifest.name);
    if (coreName && coreName !== name) aliases.add(coreName);
    for (const alias of manifest.aliases ?? []) {
      const normalized = normalizeLabel(alias);
      if (normalized) aliases.add(normalized);
    }

    return {
      id: manifest.id,
      slug: normalizeLabel(manifest.id),
      name,
      aliases,
      brand: brandLabelOf(manifest.baseUrl),
    };
  });
}

function reasonFor({
  labels,
  vendorLabels,
  vendorBrand,
}: {
  labels: PreparedManifest;
  vendorLabels: ReadonlySet<string>;
  vendorBrand: string;
}): VendorIntegrationMatchReason | null {
  if (labels.slug && vendorLabels.has(labels.slug)) return 'slug';
  if (labels.name && vendorLabels.has(labels.name)) return 'name';
  for (const alias of labels.aliases) {
    if (vendorLabels.has(alias)) return 'alias';
  }
  if (
    vendorBrand &&
    (vendorBrand === labels.slug ||
      vendorBrand === labels.name ||
      vendorBrand === labels.brand)
  ) {
    return 'domain';
  }

  return null;
}

/**
 * Order matches so the best one comes first: connected integrations lead (only
 * a connected integration can supply checks and users), then match strength,
 * then slug for a stable order. Re-rankable on its own, so a caller that
 * matched before it knew the org's connections doesn't have to match again.
 */
export function rankVendorIntegrationMatches(
  matches: readonly VendorIntegrationMatch[],
  connectedSlugs: ReadonlySet<string> = new Set(),
): VendorIntegrationMatch[] {
  return [...matches].sort((a, b) => {
    const byConnection =
      Number(connectedSlugs.has(b.slug)) - Number(connectedSlugs.has(a.slug));
    if (byConnection !== 0) return byConnection;
    const byTier =
      MATCH_TIERS.indexOf(a.matchedOn) - MATCH_TIERS.indexOf(b.matchedOn);
    if (byTier !== 0) return byTier;
    return a.slug.localeCompare(b.slug);
  });
}

/**
 * Every integration that identifies the same third party as this vendor, in
 * match-strength order. Callers that know which integrations are connected
 * re-rank with {@link rankVendorIntegrationMatches}.
 */
export function findVendorIntegrationMatches({
  vendorName,
  vendorWebsite,
  manifests,
}: {
  vendorName: string;
  vendorWebsite?: string | null;
  manifests: readonly PreparedManifest[];
}): VendorIntegrationMatch[] {
  const vendorLabels = new Set<string>();
  const nameNormalized = normalizeLabel(vendorName);
  if (nameNormalized) vendorLabels.add(nameNormalized);
  const coreName = normalizeCoreName(vendorName);
  if (coreName) vendorLabels.add(coreName);
  const vendorBrand = brandLabelOf(vendorWebsite);

  if (vendorLabels.size === 0 && !vendorBrand) return [];

  const matches: VendorIntegrationMatch[] = [];
  for (const labels of manifests) {
    const matchedOn = reasonFor({ labels, vendorLabels, vendorBrand });
    if (matchedOn) matches.push({ slug: labels.id, matchedOn });
  }

  return rankVendorIntegrationMatches(matches);
}
