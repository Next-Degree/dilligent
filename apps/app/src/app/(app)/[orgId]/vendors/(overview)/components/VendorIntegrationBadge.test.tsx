import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VendorIntegrationLinkForVendor } from '@/hooks/use-vendor-integration';
import { VendorIntegrationBadge } from './VendorIntegrationBadge';

const mockUseVendorIntegrationLinks = vi.fn();
vi.mock('@/hooks/use-vendor-integration', () => ({
  useVendorIntegrationLinks: () => mockUseVendorIntegrationLinks(),
}));

const link = (
  overrides: Partial<VendorIntegrationLinkForVendor> = {},
): VendorIntegrationLinkForVendor => ({
  vendorId: 'vnd_1',
  slug: 'github',
  name: 'GitHub',
  logoUrl: null,
  connected: true,
  connectionId: 'icn_1',
  lastSyncAt: null,
  nextSyncAt: null,
  category: 'Development',
  matchedOn: 'slug',
  ...overrides,
});

function mockLinks(links: VendorIntegrationLinkForVendor[]) {
  mockUseVendorIntegrationLinks.mockReturnValue({
    linksByVendorId: new Map(links.map((l) => [l.vendorId, l])),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VendorIntegrationBadge', () => {
  it('names the connected integration monitoring the vendor', () => {
    mockLinks([link()]);
    render(<VendorIntegrationBadge vendorId="vnd_1" />);
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('renders nothing when the matched integration is not connected', () => {
    mockLinks([link({ connected: false, connectionId: null })]);
    const { container } = render(<VendorIntegrationBadge vendorId="vnd_1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a vendor with no matching integration', () => {
    mockLinks([link({ vendorId: 'vnd_other' })]);
    const { container } = render(<VendorIntegrationBadge vendorId="vnd_1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
