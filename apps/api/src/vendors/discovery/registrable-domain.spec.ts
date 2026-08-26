import { registrableDomain } from './registrable-domain';

describe('registrableDomain', () => {
  it('reduces subdomains to the registered name', () => {
    expect(registrableDomain('app.slack.com')).toBe('slack.com');
    expect(registrableDomain('www.slack.com')).toBe('slack.com');
    expect(registrableDomain('slack.com')).toBe('slack.com');
  });

  it('accepts full URLs as well as bare hostnames', () => {
    expect(registrableDomain('https://app.slack.com/client/T1')).toBe('slack.com');
    expect(registrableDomain('http://slack.com')).toBe('slack.com');
  });

  it('keeps the registered label under a multi-label public suffix', () => {
    // Without this, two unrelated UK vendors both reduce to "co.uk" and compare equal.
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('example.com.au')).toBe('example.com.au');
  });

  it('does not treat a bare public suffix as a vendor identity', () => {
    expect(registrableDomain('co.uk')).toBeNull();
  });

  it('rejects hosts that identify a machine rather than a company', () => {
    expect(registrableDomain('192.168.1.1')).toBeNull();
    expect(registrableDomain('localhost')).toBeNull();
    expect(registrableDomain('[::1]')).toBeNull();
  });

  it('returns null for unusable input rather than an empty string', () => {
    // Callers must not match nulls against each other.
    expect(registrableDomain(null)).toBeNull();
    expect(registrableDomain('')).toBeNull();
    expect(registrableDomain('   ')).toBeNull();
  });

  it('ignores case and trailing dots', () => {
    expect(registrableDomain('APP.Slack.COM.')).toBe('slack.com');
  });

  it('distinguishes different registrable domains', () => {
    expect(registrableDomain('slack.com')).not.toBe(registrableDomain('slack.io'));
  });
});
