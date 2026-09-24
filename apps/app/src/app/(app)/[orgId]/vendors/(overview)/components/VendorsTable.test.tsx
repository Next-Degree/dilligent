import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setMockPermissions,
  mockHasPermission,
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
} from '@/test-utils/mocks/permissions';

// Mock usePermissions
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

// Mock useVendors and useVendorActions
const mockDeleteVendor = vi.fn();
vi.mock('@/hooks/use-vendors', () => ({
  useVendors: () => ({ data: null }),
  useVendorActions: () => ({
    deleteVendor: mockDeleteVendor,
  }),
}));

// Mock useOnboardingStatus
vi.mock('../hooks/use-onboarding-status', () => ({
  useOnboardingStatus: () => ({
    itemStatuses: {},
    progress: null,
    itemsInfo: [],
    isActive: false,
    isLoading: false,
  }),
}));

// Mock vendor-onboarding-context
vi.mock('./vendor-onboarding-context', () => ({
  VendorOnboardingProvider: ({ children }: any) => <div>{children}</div>,
  useVendorOnboardingStatus: () => ({}),
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock OnboardingLoadingAnimation
vi.mock('@/components/onboarding-loading-animation', () => ({
  OnboardingLoadingAnimation: () => <div data-testid="onboarding-loading" />,
}));

// Mock VendorStatus
vi.mock('@/components/vendor-status', () => ({
  VendorStatus: ({ status }: any) => (
    <span data-testid="vendor-status">{status}</span>
  ),
}));

// Mock design system
vi.mock('@trycompai/design-system', () => ({
  AlertDialog: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  Avatar: ({ children }: any) => <div>{children}</div>,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
  AvatarImage: () => null,
  Badge: ({ children }: any) => <span>{children}</span>,
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  DropdownMenuTrigger: ({ children, ...props }: any) => (
    <button data-testid="actions-trigger" {...props}>
      {children}
    </button>
  ),
  Empty: ({ children }: any) => <div data-testid="empty-state">{children}</div>,
  EmptyDescription: ({ children }: any) => <p>{children}</p>,
  EmptyHeader: ({ children }: any) => <div>{children}</div>,
  EmptyTitle: ({ children }: any) => <h3>{children}</h3>,
  HStack: ({ children }: any) => <div>{children}</div>,
  InputGroup: ({ children }: any) => <div>{children}</div>,
  InputGroupAddon: ({ children }: any) => <div>{children}</div>,
  InputGroupInput: (props: any) => <input {...props} />,
  Spinner: () => <span data-testid="spinner" />,
  Stack: ({ children }: any) => <div>{children}</div>,
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
  Text: ({ children }: any) => <span>{children}</span>,
}));

// Mock design system icons
vi.mock('@trycompai/design-system/icons', () => ({
  OverflowMenuVertical: () => <span data-testid="overflow-icon" />,
  Search: () => <span data-testid="search-icon" />,
  TrashCan: () => <span data-testid="trash-icon" />,
}));

// The real filter is a design-system Popover; this suite mocks the whole design
// system, so stand in for it with buttons that drive the same onChange contract.
// The popover itself is covered by VendorCategoryFilter's own suite.
vi.mock('./VendorCategoryFilter', () => ({
  VendorCategoryFilter: ({
    value,
    onChange,
  }: {
    value: string[];
    onChange: (next: string[]) => void;
  }) => (
    <div>
      <span data-testid="category-filter-value">{value.join(',')}</span>
      <button type="button" onClick={() => onChange(['finance'])}>
        Filter Finance
      </button>
      <button type="button" onClick={() => onChange(['other'])}>
        Filter Other
      </button>
      <button type="button" onClick={() => onChange([])}>
        Clear category filter
      </button>
    </div>
  ),
}));

import { VendorsTable } from './VendorsTable';

const mockVendors: any[] = [
  {
    id: 'vendor-1',
    name: 'Acme Corp',
    description: 'A vendor',
    category: 'hr_recruiting',
    deliveryModels: ['saas'],
    dataServiceTypes: [],
    dataFlowRoles: [],
    status: 'assessed',
    treatmentStrategy: 'accept',
    inherentProbability: 'possible',
    inherentImpact: 'moderate',
    residualProbability: 'unlikely',
    residualImpact: 'minor',
    website: null,
    isSubProcessor: false,
    logoUrl: null,
    showOnTrustPortal: false,
    trustPortalOrder: null,
    complianceBadges: null,
    organizationId: 'org-1',
    assigneeId: null,
    assignee: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

const mockAssignees: any[] = [];

describe('VendorsTable', () => {
  beforeEach(() => {
    setMockPermissions({});
    vi.clearAllMocks();
  });

  it('does not render ACTIONS column when user lacks vendor:delete permission', () => {
    setMockPermissions({});

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.queryByText('ACTIONS')).not.toBeInTheDocument();
  });

  it('does not render ACTIONS column for auditor role', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.queryByText('ACTIONS')).not.toBeInTheDocument();
  });

  it('renders ACTIONS column when user has vendor:delete permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.getByText('ACTIONS')).toBeInTheDocument();
  });

  it('renders delete action trigger per row when user has vendor:delete permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.getAllByTestId('actions-trigger').length).toBeGreaterThanOrEqual(1);
  });

  it('does not render delete action trigger when user lacks vendor:delete permission', () => {
    setMockPermissions({ vendor: ['read'] });

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.queryByTestId('actions-trigger')).not.toBeInTheDocument();
  });

  it('renders vendor name and category regardless of permissions', () => {
    setMockPermissions({});

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    // Label comes from the shared helper, not a local map.
    expect(screen.getByText('HR & Recruiting')).toBeInTheDocument();
  });

  it('labels a retired category value read from an un-backfilled row', () => {
    setMockPermissions({});

    render(
      <VendorsTable
        vendors={[{ ...mockVendors[0], category: 'software_as_a_service' }]}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.getByText('SaaS (retired)')).toBeInTheDocument();
  });

  it('filters the rows down to the selected categories', async () => {
    const user = userEvent.setup();
    setMockPermissions({});

    const financeVendor = {
      ...mockVendors[0],
      id: 'vendor-2',
      name: 'Ledger Ltd',
      category: 'finance',
    };

    render(
      <VendorsTable
        vendors={[...mockVendors, financeVendor]}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Filter Finance' }));

    expect(screen.getByText('Ledger Ltd')).toBeInTheDocument();
    expect(screen.queryByText('Acme Corp')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear category filter' }));

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('keeps an un-backfilled legacy row findable under the category it maps to', async () => {
    const user = userEvent.setup();
    setMockPermissions({});

    // The filter only offers active categories, so a row still holding a retired
    // value matched nothing and disappeared the moment any category was picked.
    const legacyVendor = {
      ...mockVendors[0],
      id: 'vendor-3',
      name: 'Legacy SaaS Co',
      category: 'software_as_a_service',
    };

    render(
      <VendorsTable
        vendors={[legacyVendor]}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.getByText('Legacy SaaS Co')).toBeInTheDocument();

    // software_as_a_service migrates to `other`, so that is where it must show up.
    await user.click(screen.getByRole('button', { name: 'Filter Other' }));

    expect(screen.getByText('Legacy SaaS Co')).toBeInTheDocument();
  });

  it('renders the INHERENT RISK column with a numeric score for assessed vendors', () => {
    setMockPermissions({});

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    // Column header
    expect(screen.getByText('INHERENT RISK')).toBeInTheDocument();
    // Acme Corp (possible × moderate) → raw 9 → score 4/10
    expect(screen.getAllByText('4/10').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the CURRENT RISK column immediately after INHERENT RISK', () => {
    setMockPermissions({});

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    expect(screen.getByText('CURRENT RISK')).toBeInTheDocument();

    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => (h.textContent || '').toUpperCase());
    const inherentIdx = headers.findIndex((h) => h.includes('INHERENT RISK'));
    const residualIdx = headers.findIndex((h) => h.includes('CURRENT RISK'));
    expect(inherentIdx).toBeGreaterThanOrEqual(0);
    expect(residualIdx).toBe(inherentIdx + 1);
  });

  it('renders a current-risk score badge for assessed vendors', () => {
    setMockPermissions({});

    render(
      <VendorsTable
        vendors={mockVendors}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    // No linked work, so the treatment plan has not moved the needle: the
    // current score still equals the inherent one (4/10), rendered in both
    // the INHERENT RISK and CURRENT RISK cells.
    expect(screen.getAllByText('4/10')).toHaveLength(2);
  });

  it('shows an em-dash for vendors that have not been assessed', () => {
    setMockPermissions({});

    const notAssessedVendor = {
      ...mockVendors[0],
      id: 'vendor-2',
      name: 'Pending Inc',
      status: 'not_assessed',
    };

    render(
      <VendorsTable
        vendors={[notAssessedVendor]}
        assignees={mockAssignees}
        orgId="org-1"
      />,
    );

    // One em-dash per risk column (inherent + residual) for not_assessed vendors.
    expect(screen.getAllByText('—').length).toBe(2);
    expect(screen.queryByText('1/10')).not.toBeInTheDocument();
  });
});
