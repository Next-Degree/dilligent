import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredVendor } from '@/hooks/use-discovered-vendors';
import { DiscoveredVendorsTable } from './DiscoveredVendorsTable';

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ permissions: {}, hasPermission: mockHasPermission }),
}));

const mockIgnore = vi.fn();
const mockReopen = vi.fn();
let mockRows: DiscoveredVendor[] = [];

vi.mock('@/hooks/use-discovered-vendors', () => ({
  useDiscoveredVendors: () => ({
    discoveredVendors: mockRows,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
  useDiscoveredVendor: () => ({ discoveredVendor: null, isLoading: false, refresh: vi.fn() }),
  useDiscoveredVendorActions: () => ({
    approve: vi.fn(),
    ignore: mockIgnore,
    reopen: mockReopen,
    rescan: vi.fn(),
    isSubmitting: false,
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The sheet pulls in the vendor list and a form; the table's own behaviour is what is
// under test here.
vi.mock('./ApproveVendorSheet', () => ({
  ApproveVendorSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="approve-sheet" /> : null,
}));

const candidate = (overrides: Partial<DiscoveredVendor> = {}): DiscoveredVendor => ({
  id: 'dvc_1',
  externalAppId: 'slack.client',
  displayName: 'Slack',
  status: 'pending',
  ignoredReason: null,
  granteeCount: 4,
  scopes: [],
  firstSeenAt: '2026-08-01T00:00:00.000Z',
  lastSeenAt: '2026-08-19T00:00:00.000Z',
  disappearedAt: null,
  resolutionMethod: 'global_catalogue',
  resolvedName: 'Slack',
  resolvedWebsite: 'https://slack.com',
  resolvedDescription: 'Team chat',
  confidence: 1,
  vendorId: null,
  vendor: null,
  ...overrides,
});

describe('DiscoveredVendorsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRows = [candidate()];
    setMockPermissions(ADMIN_PERMISSIONS);
  });

  it('lists a discovered application with its grantee count', () => {
    render(<DiscoveredVendorsTable />);

    expect(screen.getByText('Slack')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('says that only Google sign-ins are visible', () => {
    // The queue must not read as a complete SaaS inventory — anything signed up for with a
    // password or a personal address is invisible to this signal.
    render(<DiscoveredVendorsTable />);

    expect(screen.getByText(/signed up for another way will not appear/i)).toBeInTheDocument();
  });

  it('describes access as authorized rather than recently used', () => {
    render(<DiscoveredVendorsTable />);

    expect(screen.queryByText(/recently used/i)).not.toBeInTheDocument();
    expect(screen.getByText(/signed into with their work Google account/i)).toBeInTheDocument();
  });

  describe('permission gating', () => {
    it('offers approve and ignore to a user who can create vendors', () => {
      render(<DiscoveredVendorsTable />);

      expect(screen.getByRole('button', { name: /add vendor/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /ignore/i })).toBeInTheDocument();
    });

    it('hides both actions from a read-only user', () => {
      setMockPermissions(AUDITOR_PERMISSIONS);

      render(<DiscoveredVendorsTable />);

      // Auditors can read the queue but must not be able to mint vendors from it.
      expect(screen.queryByRole('button', { name: /add vendor/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /ignore/i })).not.toBeInTheDocument();
      expect(screen.getByText('Slack')).toBeInTheDocument();
    });

    it('hides approve but keeps ignore when a user can update but not create', () => {
      setMockPermissions({ vendor: ['read', 'update'] });

      render(<DiscoveredVendorsTable />);

      expect(screen.queryByRole('button', { name: /add vendor/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /ignore/i })).toBeInTheDocument();
    });
  });

  it('offers no bulk-approve control', () => {
    // Vendor research is globally serialised, so approving a page at once would stall
    // every organization's assessments behind this one.
    mockRows = [candidate(), candidate({ id: 'dvc_2', displayName: 'Figma' })];

    render(<DiscoveredVendorsTable />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve all|add all|bulk/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /add vendor/i })).toHaveLength(2);
  });

  it('opens the approval sheet rather than approving directly from the row', async () => {
    render(<DiscoveredVendorsTable />);

    await userEvent.click(screen.getByRole('button', { name: /add vendor/i }));

    expect(screen.getByTestId('approve-sheet')).toBeInTheDocument();
  });

  it('ignores an application in place', async () => {
    render(<DiscoveredVendorsTable />);

    await userEvent.click(screen.getByRole('button', { name: /ignore/i }));

    expect(mockIgnore).toHaveBeenCalledWith('dvc_1');
  });

  describe('the ignored list', () => {
    beforeEach(() => {
      mockRows = [candidate({ status: 'ignored' })];
    });

    it('offers reopen instead of approve', async () => {
      render(<DiscoveredVendorsTable status="ignored" />);

      expect(screen.queryByRole('button', { name: /add vendor/i })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /reopen/i }));
      expect(mockReopen).toHaveBeenCalledWith('dvc_1');
    });

    it('hides reopen from a read-only user', () => {
      setMockPermissions(AUDITOR_PERMISSIONS);

      render(<DiscoveredVendorsTable status="ignored" />);

      expect(screen.queryByRole('button', { name: /reopen/i })).not.toBeInTheDocument();
    });
  });

  it('explains an empty queue rather than showing a bare table', () => {
    mockRows = [];

    render(<DiscoveredVendorsTable />);

    expect(screen.getByText('Nothing to review')).toBeInTheDocument();
  });
});
