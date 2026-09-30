import { render } from '@react-email/render';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MagicLinkEmail } from './magic-link';

describe('MagicLinkEmail branding', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves the Dilligent logo from the portal', async () => {
    vi.stubEnv('NEXT_PUBLIC_PORTAL_URL', 'https://portal.example.com');

    const html = await render(<MagicLinkEmail email="user@example.com" url="https://x.test/m" />);

    expect(html).toContain('https://portal.example.com/dilligent-logo.png');
    expect(html).not.toContain('assets.trycomp.ai');
  });
});
