import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setMockPermissions,
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
} from '@/test-utils/mocks/permissions';

const mockUpdateOrganization = vi.fn();

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

vi.mock('@/hooks/use-organization-mutations', () => ({
  useOrganizationMutations: () => ({
    updateOrganization: mockUpdateOrganization,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { UpdateOrganizationWebsite } from './update-organization-website';

describe('UpdateOrganizationWebsite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockPermissions(ADMIN_PERMISSIONS);
  });

  it('renders with the current website', () => {
    render(<UpdateOrganizationWebsite organizationWebsite="https://acme.com" />);
    expect(screen.getByDisplayValue('https://acme.com')).toBeInTheDocument();
  });

  it('calls updateOrganization on submit and shows success toast', async () => {
    mockUpdateOrganization.mockResolvedValue({ website: 'https://new.com' });

    render(<UpdateOrganizationWebsite organizationWebsite="https://acme.com" />);

    const input = screen.getByDisplayValue('https://acme.com');
    fireEvent.change(input, { target: { value: 'https://new.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockUpdateOrganization).toHaveBeenCalledWith({
        website: 'https://new.com',
      });
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Organization website updated');
    });
  });

  it('shows error toast when mutation throws', async () => {
    mockUpdateOrganization.mockRejectedValue(new Error('Forbidden'));

    render(<UpdateOrganizationWebsite organizationWebsite="https://acme.com" />);

    const input = screen.getByDisplayValue('https://acme.com');
    fireEvent.change(input, { target: { value: 'https://new.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Error updating organization website');
    });
  });

  describe('permission gating', () => {
    it('disables Save button when user lacks organization:update permission', () => {
      setMockPermissions(AUDITOR_PERMISSIONS);
      render(<UpdateOrganizationWebsite organizationWebsite="https://acme.com" />);
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    it('enables Save button when user has organization:update permission', () => {
      setMockPermissions(ADMIN_PERMISSIONS);
      render(<UpdateOrganizationWebsite organizationWebsite="https://acme.com" />);
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });
  });
});
