import { afterEach, describe, expect, it } from 'bun:test';
import { logoUrl } from './logo';

describe('logoUrl', () => {
  const ORIGINAL_LOGO_DEV_TOKEN = process.env.LOGO_DEV_TOKEN;
  const ORIGINAL_NEXT_PUBLIC_LOGO_DEV_TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

  afterEach(() => {
    if (ORIGINAL_LOGO_DEV_TOKEN === undefined) {
      delete process.env.LOGO_DEV_TOKEN;
    } else {
      process.env.LOGO_DEV_TOKEN = ORIGINAL_LOGO_DEV_TOKEN;
    }
    if (ORIGINAL_NEXT_PUBLIC_LOGO_DEV_TOKEN === undefined) {
      delete process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;
    } else {
      process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN = ORIGINAL_NEXT_PUBLIC_LOGO_DEV_TOKEN;
    }
  });

  it('uses the shared default token when nothing is configured', () => {
    delete process.env.LOGO_DEV_TOKEN;
    delete process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

    expect(logoUrl('github.com')).toBe('https://img.logo.dev/github.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ');
  });

  it('prefers LOGO_DEV_TOKEN when configured', () => {
    // A self-hosted instance sets this so it doesn't silently burn our account's quota.
    process.env.LOGO_DEV_TOKEN = 'pk_server_configured';
    delete process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

    expect(logoUrl('github.com')).toContain('token=pk_server_configured');
  });

  it('falls back to NEXT_PUBLIC_LOGO_DEV_TOKEN for client-bundled code', () => {
    delete process.env.LOGO_DEV_TOKEN;
    process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN = 'pk_public_configured';

    expect(logoUrl('github.com')).toContain('token=pk_public_configured');
  });

  it('prefers LOGO_DEV_TOKEN over NEXT_PUBLIC_LOGO_DEV_TOKEN when both are set', () => {
    process.env.LOGO_DEV_TOKEN = 'pk_server_configured';
    process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN = 'pk_public_configured';

    expect(logoUrl('github.com')).toContain('token=pk_server_configured');
  });

  it('defaults to a bare token param', () => {
    delete process.env.LOGO_DEV_TOKEN;
    delete process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

    expect(logoUrl('slack.com')).toBe('https://img.logo.dev/slack.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ');
  });

  it('appends format and retina params when requested', () => {
    delete process.env.LOGO_DEV_TOKEN;
    delete process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

    expect(logoUrl('google.com', { format: 'png', retina: true })).toBe(
      'https://img.logo.dev/google.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ&format=png&retina=true',
    );
  });

  it('appends a size param when requested', () => {
    delete process.env.LOGO_DEV_TOKEN;
    delete process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

    expect(logoUrl('slack.com', { size: 64 })).toBe(
      'https://img.logo.dev/slack.com?token=pk_AZatYxV5QDSfWpRDaBxzRQ&size=64',
    );
  });
});
