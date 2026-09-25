import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setMockPermissions,
  mockHasPermission,
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
} from '@/test-utils/mocks/permissions';

// Add useParams to the global next/navigation mock
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useParams: vi.fn(() => ({ orgId: 'org_123', taskId: 'task_123' })),
  };
});

// Mock usePermissions
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

// Mock useTask hook
const mockTask = {
  id: 'task_123',
  title: 'Test Task',
  status: 'open',
  assigneeId: null,
  frequency: null,
  department: null,
  reviewDate: null,
  controls: [],
};

vi.mock('../hooks/use-task', () => ({
  useTask: () => ({
    task: mockTask,
    isLoading: false,
  }),
}));

// Mock useOrganizationMembers
vi.mock('@/hooks/use-organization-members', () => ({
  useOrganizationMembers: () => ({
    members: [
      {
        id: 'member_1',
        user: { id: 'user_1', name: 'Test User', email: 'test@example.com', image: null },
      },
    ],
  }),
}));

// The component no longer uses a local `./PropertySelector` — Status,
// Frequency and Department render the real `@trycompai/design-system` Select
// (which exposes a native `role="combobox"` button and forwards `disabled`
// as a real HTML attribute), so those are asserted against directly rather
// than through a stale mock target. Assignee uses `SelectAssignee`, which
// pulls in `authClient`/org-context, so it's mocked here to capture whatever
// `disabled` prop it's actually given.
vi.mock('@/components/SelectAssignee', () => ({
  SelectAssignee: ({ disabled }: { disabled?: boolean }) => (
    <div data-testid="select-assignee" data-disabled={disabled ? 'true' : 'false'} />
  ),
}));

vi.mock('./constants', () => ({
  DEPARTMENT_COLORS: { none: '#888' },
  taskDepartments: ['none'],
  taskFrequencies: ['daily', 'weekly'],
  taskStatuses: ['open', 'done'],
}));

vi.mock('../../components/TaskStatusIndicator', () => ({
  TaskStatusIndicator: ({ status }: { status: string }) => (
    <span data-testid="status-indicator">{status}</span>
  ),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, ...props }: { children: React.ReactNode; href: string }) => (
    <a {...props}>{children}</a>
  ),
}));

// Mock date-fns
vi.mock('date-fns', () => ({
  format: (date: Date, fmt: string) => '1/1/2024',
}));

// Mock @trycompai/ui components
vi.mock('@trycompai/ui/avatar', () => ({
  Avatar: ({ children, ...props }: { children: React.ReactNode; className?: string }) => (
    <div {...props}>{children}</div>
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
}));

vi.mock('@trycompai/ui/badge', () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@trycompai/ui/button', () => ({
  Button: ({
    children,
    disabled,
    ...props
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    variant?: string;
    className?: string;
  }) => (
    <button disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

import { TaskPropertiesSidebar } from './TaskPropertiesSidebar';

const defaultProps = {
  handleUpdateTask: vi.fn(),
  initialMembers: [],
};

describe('TaskPropertiesSidebar permission gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enables the Status, Frequency and Department selects when user has task:update', () => {
    setMockPermissions(ADMIN_PERMISSIONS);

    render(<TaskPropertiesSidebar {...defaultProps} />);

    // Status, Frequency, Department all render the real design-system
    // Select, which exposes a native combobox button.
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(3);
    for (const select of selects) {
      expect(select).not.toBeDisabled();
    }
  });

  it('disables the Status, Frequency and Department selects when user lacks task:update', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);

    render(<TaskPropertiesSidebar {...defaultProps} />);

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(3);
    for (const select of selects) {
      expect(select).toBeDisabled();
    }
  });

  it('enables the selects when user has task:update (assign is part of update)', () => {
    setMockPermissions({ task: ['read', 'update'] });

    render(<TaskPropertiesSidebar {...defaultProps} />);

    const selects = screen.getAllByRole('combobox');
    for (const select of selects) {
      expect(select).not.toBeDisabled();
    }
  });

  it('renders Evidence Settings heading regardless of permissions', () => {
    setMockPermissions({});

    render(<TaskPropertiesSidebar {...defaultProps} />);

    expect(screen.getByText('Evidence Settings')).toBeInTheDocument();
  });
});
