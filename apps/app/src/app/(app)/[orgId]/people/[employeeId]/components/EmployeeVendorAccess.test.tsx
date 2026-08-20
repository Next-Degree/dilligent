import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeVendorAccess } from './EmployeeVendorAccess';

let mockGrants: unknown[] = [];

vi.mock('swr', () => ({
  default: () => ({ data: mockGrants, isLoading: false, error: null }),
}));

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }));

const grant = (overrides: Record<string, unknown> = {}) => ({
  id: 'vag_1',
  scopes: ['scope.read'],
  source: 'google_workspace',
  externalAppId: 'slack.client',
  firstSeenAt: '2026-08-01T00:00:00.000Z',
  lastSeenAt: '2026-08-19T00:00:00.000Z',
  revokedAt: null,
  revokedReason: null,
  reappearedAt: null,
  vendor: { id: 'vnd_1', name: 'Slack', website: 'https://slack.com' },
  candidate: null,
  ...overrides,
});

describe('EmployeeVendorAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGrants = [grant()];
  });

  it('lists an application the person has authorized', () => {
    render(<EmployeeVendorAccess memberId="mem_1" />);

    expect(screen.getByText('Slack')).toBeInTheDocument();
  });

  it('describes access as authorized, never as recently used', () => {
    // The Tokens API carries no last-used signal, so implying recency would misrepresent
    // the evidence.
    render(<EmployeeVendorAccess memberId="mem_1" />);

    expect(screen.getByText(/does not indicate recent use/i)).toBeInTheDocument();
    expect(screen.queryByText(/last used/i)).not.toBeInTheDocument();
  });

  it('falls back to the candidate name when no vendor was approved', () => {
    mockGrants = [
      grant({ vendor: null, candidate: { id: 'dvc_1', displayName: 'Some App', status: 'pending', resolvedName: null } }),
    ];

    render(<EmployeeVendorAccess memberId="mem_1" />);

    expect(screen.getByText('Some App')).toBeInTheDocument();
  });

  it('distinguishes an offboarding revocation from access that stopped being observed', () => {
    // An auditor needs to tell "a person confirmed removal" from "we stopped seeing it".
    mockGrants = [
      grant({ id: 'vag_a', revokedAt: '2026-08-10T00:00:00.000Z', revokedReason: 'offboarding' }),
      grant({
        id: 'vag_b',
        revokedAt: '2026-08-10T00:00:00.000Z',
        revokedReason: 'not_observed',
        vendor: { id: 'vnd_2', name: 'Figma', website: null },
      }),
    ];

    render(<EmployeeVendorAccess memberId="mem_1" />);

    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText('No longer seen')).toBeInTheDocument();
  });

  it('flags access that reappeared after being revoked at offboarding', () => {
    mockGrants = [
      grant({
        revokedAt: '2026-08-10T00:00:00.000Z',
        revokedReason: 'offboarding',
        reappearedAt: '2026-08-18T00:00:00.000Z',
      }),
    ];

    render(<EmployeeVendorAccess memberId="mem_1" />);

    // Someone re-authorized after leaving — a finding, not a data refresh.
    expect(screen.getByText('Reappeared')).toBeInTheDocument();
  });

  it('says why the list may be empty rather than showing nothing', () => {
    mockGrants = [];

    render(<EmployeeVendorAccess memberId="mem_1" />);

    expect(screen.getByText(/Only apps signed into with a work Google account/i)).toBeInTheDocument();
  });
});
