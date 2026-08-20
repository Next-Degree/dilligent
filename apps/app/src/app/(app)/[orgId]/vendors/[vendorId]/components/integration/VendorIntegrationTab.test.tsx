import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VendorIntegrationCheck,
  VendorIntegrationLink,
  VendorIntegrationUser,
} from '@/hooks/use-vendor-integration';
import { VendorIntegrationTab } from './VendorIntegrationTab';

const mockUseVendorIntegration = vi.fn();
vi.mock('@/hooks/use-vendor-integration', () => ({
  useVendorIntegration: (vendorId: string) => mockUseVendorIntegration(vendorId),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const LINK: VendorIntegrationLink = {
  slug: 'github',
  name: 'GitHub',
  logoUrl: null,
  connected: true,
  connectionId: 'icn_1',
  lastSyncAt: '2026-01-05T00:00:00.000Z',
  nextSyncAt: null,
  category: 'Development',
  matchedOn: 'slug',
};

const CHECK: VendorIntegrationCheck = {
  checkId: 'github_employee_access',
  name: 'Employee Access',
  description: 'Reviews who can access the organization',
  taskMapping: 'access-control',
  lastRun: {
    runId: 'icr_1',
    status: 'success',
    startedAt: null,
    completedAt: '2026-01-05T00:00:00.000Z',
    totalChecked: 3,
    passedCount: 2,
    failedCount: 1,
    errorMessage: null,
  },
};

const USER: VendorIntegrationUser = {
  resourceId: 'ada@acme.com',
  email: 'ada@acme.com',
  name: 'Ada Lovelace',
  role: 'admin',
  isAdmin: true,
  status: 'active',
  lastLogin: '2026-01-04T00:00:00.000Z',
  passed: true,
  checks: [{ checkId: 'github_employee_access', checkName: 'Employee Access' }],
  collectedAt: '2026-01-05T00:00:00.000Z',
  member: {
    id: 'mem_1',
    name: 'Ada Lovelace',
    email: 'ada@acme.com',
    image: null,
    deactivated: false,
  },
};

function mockState(overrides: Record<string, unknown> = {}) {
  mockUseVendorIntegration.mockReturnValue({
    integration: null,
    checks: [],
    users: [],
    isLoading: false,
    error: undefined,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState();
});

describe('VendorIntegrationTab', () => {
  it('explains when no integration matches the vendor', () => {
    render(<VendorIntegrationTab vendorId="vnd_1" orgId="org_1" />);

    expect(screen.getByText('No matching integration')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse integrations' })).toHaveAttribute(
      'href',
      '/org_1/integrations',
    );
  });

  it('prompts to connect a matched but unconnected integration', () => {
    mockState({ integration: { ...LINK, connected: false, connectionId: null } });

    render(<VendorIntegrationTab vendorId="vnd_1" orgId="org_1" />);

    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Connect GitHub' }),
    ).toHaveAttribute('href', '/org_1/integrations/github');
    // Nothing to show yet — no check or user tables.
    expect(screen.queryByText('Employee Access')).not.toBeInTheDocument();
  });

  it('lists the checks and the users the integration reports', () => {
    mockState({ integration: LINK, checks: [CHECK], users: [USER] });

    render(<VendorIntegrationTab vendorId="vnd_1" orgId="org_1" />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Checks')).toBeInTheDocument();
    // Once as the check itself, once as the check that reported the user.
    expect(screen.getAllByText('Employee Access')).toHaveLength(2);
    expect(screen.getByText('2 passed · 1 failed')).toBeInTheDocument();
    expect(screen.getByText('1 failing')).toBeInTheDocument();

    expect(screen.getByText('Users (1)')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@acme.com')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('flags a user a check reported as failing', () => {
    mockState({
      integration: LINK,
      checks: [CHECK],
      users: [{ ...USER, passed: false }],
    });

    render(<VendorIntegrationTab vendorId="vnd_1" orgId="org_1" />);
    expect(screen.getByText('Flagged')).toBeInTheDocument();
  });

  it('marks a reported account that is not an org member', () => {
    mockState({
      integration: LINK,
      checks: [CHECK],
      users: [{ ...USER, member: null }],
    });

    render(<VendorIntegrationTab vendorId="vnd_1" orgId="org_1" />);
    expect(screen.getByText('Not a member')).toBeInTheDocument();
  });

  it('tells the user when a connected integration has reported nobody yet', () => {
    mockState({ integration: LINK, checks: [CHECK], users: [] });

    render(<VendorIntegrationTab vendorId="vnd_1" orgId="org_1" />);
    expect(screen.getByText('No users reported')).toBeInTheDocument();
  });
});
