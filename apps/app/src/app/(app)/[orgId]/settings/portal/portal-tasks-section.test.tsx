import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

const mockSetPublished = vi.fn();
const mockArchiveTask = vi.fn();
const mockCreateTask = vi.fn();
const mockUpdateTask = vi.fn();
let mockTasks: unknown[] = [];

vi.mock('./hooks/use-portal-tasks', () => ({
  usePortalTasks: () => ({
    tasks: mockTasks,
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
    createTask: mockCreateTask,
    updateTask: mockUpdateTask,
    setPublished: mockSetPublished,
    archiveTask: mockArchiveTask,
  }),
}));

vi.mock('./portal-task-form', () => ({
  PortalTaskForm: ({ task }: { task?: { id: string } }) => (
    <div data-testid="portal-task-form">{task ? `editing:${task.id}` : 'creating'}</div>
  ),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@trycompai/design-system', () => ({
  Badge: ({ children }: any) => <span data-testid="badge">{children}</span>,
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  SettingGroup: ({ children }: any) => <div>{children}</div>,
  SettingRow: ({ children, label, description }: any) => (
    <div data-testid="setting-row">
      <span>{label}</span>
      <span>{description}</span>
      {children}
    </div>
  ),
  Switch: ({ checked, disabled, onCheckedChange, 'aria-label': ariaLabel }: any) => (
    <button
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    >
      {checked ? 'On' : 'Off'}
    </button>
  ),
}));

import { PortalTasksSection } from './portal-tasks-section';

const publishedTask = {
  id: 'ptsk_1',
  title: 'Acknowledge the Code of Conduct',
  description: null,
  kind: 'acknowledgement' as const,
  externalUrl: null,
  acknowledgementText: null,
  isPublished: true,
  isRequired: true,
  isArchived: false,
  order: 0,
  completedCount: 3,
  audienceCount: 12,
};

const draftTask = {
  ...publishedTask,
  id: 'ptsk_2',
  title: 'Read the security handbook',
  isPublished: false,
  isRequired: false,
};

describe('PortalTasksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTasks = [publishedTask, draftTask];
  });

  it('shows completion progress for a published task', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<PortalTasksSection />);

    expect(screen.getByText('3 of 12 completed')).toBeInTheDocument();
  });

  it('marks an unpublished task as not yet assigned', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<PortalTasksSection />);

    expect(
      screen.getByText('Draft — not assigned yet · optional'),
    ).toBeInTheDocument();
  });

  it('publishes a draft task through the publish switch', async () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<PortalTasksSection />);

    await userEvent.click(screen.getByLabelText('Publish task'));

    await waitFor(() =>
      expect(mockSetPublished).toHaveBeenCalledWith('ptsk_2', true),
    );
  });

  it('archives a task', async () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<PortalTasksSection />);

    await userEvent.click(screen.getAllByText('Archive')[0]);

    await waitFor(() => expect(mockArchiveTask).toHaveBeenCalledWith('ptsk_1'));
  });

  it('opens the form in edit mode for the chosen task', async () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    render(<PortalTasksSection />);

    await userEvent.click(screen.getAllByText('Edit')[0]);

    expect(screen.getByTestId('portal-task-form')).toHaveTextContent(
      'editing:ptsk_1',
    );
  });

  it('hides every mutation control from a read-only user', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    render(<PortalTasksSection />);

    expect(screen.queryByText('Add task')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Archive')).not.toBeInTheDocument();
    // The publish switch stays visible for context, but cannot be operated.
    for (const toggle of screen.getAllByRole('switch')) {
      expect(toggle).toBeDisabled();
    }
  });

  it('renders an empty state when nothing is assigned yet', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    mockTasks = [];
    render(<PortalTasksSection />);

    expect(
      screen.getByText(/No custom tasks yet/, { exact: false }),
    ).toBeInTheDocument();
  });
});
