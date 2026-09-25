import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setMockPermissions,
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
} from '@/test-utils/mocks/permissions';

const mockCreateEntry = vi.fn();
const mockUpdateEntry = vi.fn();

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    permissions: {},
    hasPermission: mockHasPermission,
  }),
}));

vi.mock('../hooks/useContextEntries', () => ({
  useContextEntries: () => ({
    createEntry: mockCreateEntry,
    updateEntry: mockUpdateEntry,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { ContextForm } from './context-form';

describe('ContextForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockPermissions(ADMIN_PERMISSIONS);
  });

  it('renders create form when no entry is provided', () => {
    render(<ContextForm />);
    expect(screen.getByLabelText(/question/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/answer/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('renders update form when entry is provided', () => {
    const entry = {
      id: 'ctx_1',
      question: 'What is X?',
      answer: 'X is Y',
      tags: [],
      organizationId: 'org_123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    render(<ContextForm entry={entry} />);
    expect(screen.getByDisplayValue('What is X?')).toBeInTheDocument();
    expect(screen.getByDisplayValue('X is Y')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
  });

  it('calls createEntry for new entries and shows success toast', async () => {
    mockCreateEntry.mockResolvedValue({ id: 'ctx_new' });
    const onSuccess = vi.fn();

    render(<ContextForm onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText(/question/i), {
      target: { value: 'New question?' },
    });
    fireEvent.change(screen.getByLabelText(/answer/i), {
      target: { value: 'New answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(mockCreateEntry).toHaveBeenCalledWith({
        question: 'New question?',
        answer: 'New answer',
      });
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Context entry created');
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('calls updateEntry for existing entries and shows success toast', async () => {
    mockUpdateEntry.mockResolvedValue({});
    const onSuccess = vi.fn();

    const entry = {
      id: 'ctx_1',
      question: 'Old question',
      answer: 'Old answer',
      tags: [],
      organizationId: 'org_123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    render(<ContextForm entry={entry} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByDisplayValue('Old answer'), {
      target: { value: 'Updated answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /update/i }));

    await waitFor(() => {
      expect(mockUpdateEntry).toHaveBeenCalledWith('ctx_1', {
        question: 'Old question',
        answer: 'Updated answer',
      });
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Context entry updated');
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('shows error toast on api failure', async () => {
    mockCreateEntry.mockRejectedValue(new Error('Server error'));

    render(<ContextForm />);

    fireEvent.change(screen.getByLabelText(/question/i), {
      target: { value: 'Question' },
    });
    fireEvent.change(screen.getByLabelText(/answer/i), {
      target: { value: 'Answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Something went wrong');
    });
  });

  describe('permission gating', () => {
    it('disables submit button when user lacks evidence:update permission', () => {
      setMockPermissions(AUDITOR_PERMISSIONS);
      render(<ContextForm />);
      expect(screen.getByRole('button', { name: /create/i })).toBeDisabled();
    });

    it('enables submit button when user has evidence:update permission', () => {
      setMockPermissions(ADMIN_PERMISSIONS);
      render(<ContextForm />);
      expect(screen.getByRole('button', { name: /create/i })).not.toBeDisabled();
    });
  });
});
