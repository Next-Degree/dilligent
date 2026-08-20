import {
  brandLabelOf,
  findVendorIntegrationMatches,
  normalizeLabel,
  prepareManifests,
  rankVendorIntegrationMatches,
} from './vendor-integration-match';

// Mirrors the real catalog: aliases are declared by the manifest itself.
const MANIFESTS = [
  { id: 'github', name: 'GitHub', baseUrl: 'https://api.github.com' },
  {
    id: 'github-app',
    name: 'GitHub App',
    baseUrl: 'https://api.github.com',
    aliases: ['github'],
  },
  {
    id: 'aws',
    name: 'Amazon Web Services',
    baseUrl: '',
    aliases: ['aws', 'amazon web services', 'amazon aws'],
  },
  {
    id: 'gcp',
    name: 'Google Cloud Platform',
    baseUrl: 'https://cloudresourcemanager.googleapis.com',
    aliases: ['gcp', 'google cloud', 'google cloud platform'],
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    baseUrl: 'https://admin.googleapis.com',
    aliases: ['google workspace', 'gsuite', 'g suite', 'google apps'],
  },
  {
    id: 'aikido',
    name: 'Aikido Security',
    baseUrl: 'https://app.aikido.dev/api/public/v1/',
  },
  { id: 'asana', name: 'Asana', baseUrl: 'https://app.asana.com/' },
  { id: 'linear', name: 'Linear', baseUrl: 'https://api.linear.app' },
];

const matchAll = (
  vendorName: string,
  vendorWebsite: string | null = null,
  connectedSlugs?: Set<string>,
) => {
  const matches = findVendorIntegrationMatches({
    vendorName,
    vendorWebsite,
    manifests: prepareManifests(MANIFESTS),
  });
  // Connection-aware ordering is a second step, exactly as the service does it.
  return connectedSlugs
    ? rankVendorIntegrationMatches(matches, connectedSlugs)
    : matches;
};

const match = (
  vendorName: string,
  vendorWebsite: string | null = null,
  connectedSlugs?: Set<string>,
) => matchAll(vendorName, vendorWebsite, connectedSlugs)[0] ?? null;

describe('normalizeLabel / brandLabelOf', () => {
  it('reduces a name to comparable letters and digits', () => {
    expect(normalizeLabel('Google Workspace')).toBe('googleworkspace');
    expect(normalizeLabel('1Password!')).toBe('1password');
    expect(normalizeLabel(null)).toBe('');
  });

  it('takes the brand label past generic endpoint subdomains', () => {
    expect(brandLabelOf('https://app.aikido.dev/api/public/v1/')).toBe(
      'aikido',
    );
    expect(brandLabelOf('https://api.github.com')).toBe('github');
    expect(brandLabelOf('asana.com')).toBe('asana');
    expect(brandLabelOf('https://www.example.co.uk/pricing')).toBe('example');
    expect(brandLabelOf('not a url')).toBe('');
    expect(brandLabelOf(null)).toBe('');
  });
});

describe('findVendorIntegrationMatches', () => {
  it('matches on an exact name', () => {
    expect(match('GitHub')).toEqual({ slug: 'github', matchedOn: 'slug' });
    expect(match('Google Workspace')).toEqual({
      slug: 'google-workspace',
      matchedOn: 'slug',
    });
  });

  it('matches a curated alias for vendors named differently than the manifest', () => {
    expect(match('AWS')).toEqual({ slug: 'aws', matchedOn: 'slug' });
    expect(match('Amazon Web Services')).toEqual({
      slug: 'aws',
      matchedOn: 'name',
    });
    expect(match('Google Cloud')).toEqual({ slug: 'gcp', matchedOn: 'alias' });
  });

  it('ignores trailing descriptor words on either side', () => {
    expect(match('Aikido')).toEqual({ slug: 'aikido', matchedOn: 'slug' });
    expect(match('Asana, Inc.')).toEqual({ slug: 'asana', matchedOn: 'slug' });
  });

  it('falls back to the website brand label', () => {
    expect(match('Linear (issue tracker)', 'https://linear.app')).toEqual({
      slug: 'linear',
      matchedOn: 'domain',
    });
  });

  it('does not match unrelated vendors', () => {
    expect(match('Stripe', 'https://stripe.com')).toBeNull();
    expect(match('')).toBeNull();
  });

  it('never matches on a generic descriptor alone', () => {
    expect(match('Security')).toBeNull();
  });

  it('prefers a connected integration when several identify the vendor', () => {
    const all = findVendorIntegrationMatches({
      vendorName: 'GitHub',
      vendorWebsite: 'https://github.com',
      manifests: prepareManifests(MANIFESTS),
    }).map((m) => m.slug);
    expect(all).toEqual(['github', 'github-app']);

    expect(
      match('GitHub', 'https://github.com', new Set(['github-app'])),
    ).toEqual({
      slug: 'github-app',
      matchedOn: 'alias',
    });
  });

  it('is stable regardless of manifest order', () => {
    const reversed = [...MANIFESTS].reverse();
    expect(
      findVendorIntegrationMatches({
        vendorName: 'GitHub',
        vendorWebsite: 'https://github.com',
        manifests: prepareManifests(reversed),
      })[0],
    ).toEqual({ slug: 'github', matchedOn: 'slug' });
  });
});
