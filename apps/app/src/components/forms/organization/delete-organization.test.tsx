import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILT_IN_ROLE_PERMISSIONS } from '@trycompai/auth';
import {
  setMockPermissions,
  ADMIN_PERMISSIONS,
  mockHasPermission,
} from '@/test-utils/mocks/permissions';

// Only the owner role has organization:delete — admins are explicitly excluded
// (see packages/auth/src/permissions.ts), so tests that expect the delete UI
// to render use the owner permission set rather than admin.
const OWNER_PERMISSIONS = BUILT_IN_ROLE_PERMISSIONS.owner;

const mockDeleteOrganization = vi.fn();

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

vi.mock('@/hooks/use-organization-mutations', () => ({
  useOrganizationMutations: () => ({
    deleteOrganization: mockDeleteOrganization,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { DeleteOrganization } from './delete-organization';

describe('DeleteOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockPermissions(OWNER_PERMISSIONS);
  });

  it('does not render for non-owners', () => {
    const { container } = render(
      <DeleteOrganization organizationId="org_123" isOwner={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders for owners', () => {
    render(<DeleteOrganization organizationId="org_123" isOwner={true} />);
    expect(screen.getByText('Delete organization')).toBeInTheDocument();
  });

  it('does not render when the user lacks organization:delete permission', () => {
    setMockPermissions(ADMIN_PERMISSIONS);
    const { container } = render(
      <DeleteOrganization organizationId="org_123" isOwner={true} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it("requires typing 'delete' to enable the confirm button", () => {
    render(<DeleteOrganization organizationId="org_123" isOwner={true} />);

    // Open dialog
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    // Confirm button should be disabled
    const confirmButton = screen.getAllByRole('button', { name: /delete/i }).pop()!;
    expect(confirmButton).toBeDisabled();

    // Type 'delete'
    const input = screen.getByLabelText(/type 'delete' to confirm/i);
    fireEvent.change(input, { target: { value: 'delete' } });

    expect(confirmButton).not.toBeDisabled();
  });

  it('calls deleteOrganization and shows success toast', async () => {
    mockDeleteOrganization.mockResolvedValue({});

    render(<DeleteOrganization organizationId="org_123" isOwner={true} />);

    // Open dialog
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    // Type confirmation
    const input = screen.getByLabelText(/type 'delete' to confirm/i);
    fireEvent.change(input, { target: { value: 'delete' } });

    // Click confirm
    const confirmButton = screen.getAllByRole('button', { name: /delete/i }).pop()!;
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockDeleteOrganization).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Organization deleted');
    });
  });

  it('shows error toast when delete fails', async () => {
    mockDeleteOrganization.mockRejectedValue(new Error('Forbidden'));

    render(<DeleteOrganization organizationId="org_123" isOwner={true} />);

    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    const input = screen.getByLabelText(/type 'delete' to confirm/i);
    fireEvent.change(input, { target: { value: 'delete' } });

    const confirmButton = screen.getAllByRole('button', { name: /delete/i }).pop()!;
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Error deleting organization');
    });
  });
});
