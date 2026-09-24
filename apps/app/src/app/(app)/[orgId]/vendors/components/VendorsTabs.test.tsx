import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VendorsTabs } from './VendorsTabs';

let mockPathname = '/org_1/vendors';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

describe('VendorsTabs', () => {
  it('keeps the register as the default tab', () => {
    // Discovery is an inbox that is empty most days; landing there would put an empty
    // screen in front of what people came for.
    mockPathname = '/org_1/vendors';

    render(<VendorsTabs orgId="org_1" />);

    expect(screen.getByRole('link', { name: /all vendors/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks the discovered tab current on its own route', () => {
    mockPathname = '/org_1/vendors/discovered';

    render(<VendorsTabs orgId="org_1" />);

    expect(screen.getByRole('link', { name: /discovered/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows a pending count when there is something to review', () => {
    mockPathname = '/org_1/vendors';

    render(<VendorsTabs orgId="org_1" pendingCount={3} />);

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('hides the badge when nothing is pending', () => {
    mockPathname = '/org_1/vendors';

    render(<VendorsTabs orgId="org_1" pendingCount={0} />);

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('links both tabs within the organization', () => {
    mockPathname = '/org_1/vendors';

    render(<VendorsTabs orgId="org_1" />);

    expect(screen.getByRole('link', { name: /all vendors/i })).toHaveAttribute(
      'href',
      '/org_1/vendors',
    );
    expect(screen.getByRole('link', { name: /discovered/i })).toHaveAttribute(
      'href',
      '/org_1/vendors/discovered',
    );
  });

  it('keeps tabs reachable on narrow viewports', () => {
    mockPathname = '/org_1/vendors';

    const { container } = render(<VendorsTabs orgId="org_1" pendingCount={2} />);

    // Tabs scroll within their own row rather than overflowing the page.
    expect(container.querySelector('ul')?.className).toContain('overflow-x-auto');
    // Touch targets stay tappable on mobile.
    expect(screen.getByRole('link', { name: /all vendors/i }).className).toContain('min-h-10');
  });
});
