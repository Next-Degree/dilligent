import { vendorDomain, vendorLogoUrl } from './vendor-logo';

describe('vendorDomain', () => {
  it('strips the scheme and path', () => {
    expect(vendorDomain('https://slack.com/enterprise')).toBe('slack.com');
    expect(vendorDomain('http://slack.com')).toBe('slack.com');
    expect(vendorDomain('slack.com')).toBe('slack.com');
  });

  it('returns null for nothing usable', () => {
    expect(vendorDomain(null)).toBeNull();
    expect(vendorDomain('')).toBeNull();
    expect(vendorDomain('   ')).toBeNull();
  });
});

describe('vendorLogoUrl', () => {
  const ORIGINAL_TOKEN = process.env.LOGO_DEV_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.LOGO_DEV_TOKEN;
    } else {
      process.env.LOGO_DEV_TOKEN = ORIGINAL_TOKEN;
    }
  });

  it('prefers a stored logo over a derived one', () => {
    expect(
      vendorLogoUrl({ logoUrl: 'https://cdn.example.com/logo.png', website: 'https://slack.com' }),
    ).toBe('https://cdn.example.com/logo.png');
  });

  it('derives a logo from the vendor domain', () => {
    delete process.env.LOGO_DEV_TOKEN;

    expect(vendorLogoUrl({ logoUrl: null, website: 'https://slack.com' })).toContain(
      'img.logo.dev/slack.com',
    );
  });

  it('uses the configured token when one is set', () => {
    // Hardcoding it means a self-hosted instance burns someone else's account quota.
    process.env.LOGO_DEV_TOKEN = 'pk_configured';

    expect(vendorLogoUrl({ logoUrl: null, website: 'https://slack.com' })).toContain(
      'token=pk_configured',
    );
  });

  it('returns null when there is nothing to derive from', () => {
    // Callers render their own placeholder rather than a broken image.
    expect(vendorLogoUrl({ logoUrl: null, website: null })).toBeNull();
  });
});
