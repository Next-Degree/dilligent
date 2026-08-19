import {
  brandLabelOf,
  findVendorIntegrationMatches,
  normalizeLabel,
} from './vendor-integration-match';

const MANIFESTS = [
  { id: 'github', name: 'GitHub', baseUrl: 'https://api.github.com' },
  { id: 'github-app', name: 'GitHub App', baseUrl: 'https://api.github.com' },
  { id: 'aws', name: 'Amazon Web Services', baseUrl: '' },
  {
    id: 'gcp',
    name: 'Google Cloud Platform',
    baseUrl: 'https://cloudresourcemanager.googleapis.com',
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    baseUrl: 'https://admin.googleapis.com',
  },
  {
    id: 'aikido',
    name: 'Aikido Security',
    baseUrl: 'https://app.aikido.dev/api/public/v1/',
  },
  { id: 'asana', name: 'Asana', baseUrl: 'https://app.asana.com/' },
  { id: 'linear', name: 'Linear', baseUrl: 'https://api.linear.app' },
];

const match = (
  vendorName: string,
  vendorWebsite: string | null = null,
  connectedSlugs?: Set<string>,
) =>
  findVendorIntegrationMatches({
    vendorName,
    vendorWebsite,
    manifests: MANIFESTS,
    connectedSlugs,
  })[0] ?? null;

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
      manifests: MANIFESTS,
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
        manifests: reversed,
      })[0],
    ).toEqual({ slug: 'github', matchedOn: 'slug' });
  });
});
