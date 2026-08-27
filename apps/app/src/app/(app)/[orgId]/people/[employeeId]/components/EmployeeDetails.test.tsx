import type { Member, User } from '@db';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeDetails } from './EmployeeDetails';

const { mockPatch } = vi.hoisted(() => ({ mockPatch: vi.fn() }));

vi.mock('@/hooks/use-api', () => ({
  useApi: () => ({
    organizationId: 'org_1',
    patch: mockPatch,
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }),
}));

// DepartmentSelect pulls the runtime `Departments` enum from @db; its behaviour
// is irrelevant to email editing.
vi.mock('@/components/DepartmentSelect', () => ({
  DepartmentSelect: () => null,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// jsdom doesn't implement the pointer APIs Radix Select relies on.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const employee = {
  id: 'mem_1',
  userId: 'usr_1',
  organizationId: 'org_1',
  role: 'employee',
  createdAt: new Date(),
  department: 'engineering',
  jobTitle: 'Engineer',
  isActive: true,
  employmentType: 'permanent',
  contractExpiryDate: null,
  onboardDate: null,
  offboardDate: null,
  user: {
    id: 'usr_1',
    name: 'Manoj Madhavan',
    email: 'manoj.madhavan@plurilock.com',
  },
} as unknown as Member & { user: User };

describe('EmployeeDetails email editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatch.mockResolvedValue({ data: {}, status: 200 });
  });

  it('lets an admin change the login email and PATCHes it to the people endpoint', async () => {
    const user = userEvent.setup();
    render(<EmployeeDetails employee={employee} canEdit />);

    const emailInput = screen.getByLabelText('Email');
    // Regression: the field used to be hardcoded disabled+readOnly.
    expect(emailInput).not.toBeDisabled();

    await user.clear(emailInput);
    await user.type(emailInput, 'mmadhavan@aurorait.com');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/people/mem_1', {
        email: 'mmadhavan@aurorait.com',
      });
    });
  });

  it('disables the email field for read-only users', () => {
    render(<EmployeeDetails employee={employee} canEdit={false} />);
    expect(screen.getByLabelText('Email')).toBeDisabled();
  });

  it('blocks save and does not PATCH when the email is cleared', async () => {
    const user = userEvent.setup();
    render(<EmployeeDetails employee={employee} canEdit />);

    const emailInput = screen.getByLabelText('Email');
    await user.clear(emailInput);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(toast.error).toHaveBeenCalledWith('Email is required');
    expect(mockPatch).not.toHaveBeenCalled();
  });
});

const contractor = {
  ...employee,
  employmentType: 'contract',
  contractExpiryDate: new Date('2026-12-31T12:00:00.000Z'),
} as unknown as Member & { user: User };

describe('EmployeeDetails employment type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPatch.mockResolvedValue({ data: {}, status: 200 });
  });

  it('hides the contract expiry field for permanent members', () => {
    render(<EmployeeDetails employee={employee} canEdit />);

    expect(screen.getByLabelText('Employment Type')).toHaveTextContent('Permanent');
    expect(screen.queryByLabelText('Contract Expiry Date')).not.toBeInTheDocument();
  });

  it('shows the stored expiry for a contract member', () => {
    render(<EmployeeDetails employee={contractor} canEdit />);

    expect(screen.getByLabelText('Employment Type')).toHaveTextContent('Contract');
    expect(screen.getByLabelText('Contract Expiry Date')).toHaveTextContent(
      'December 31st, 2026',
    );
  });

  it('reveals the expiry field on switching to contract and blocks save until it is set', async () => {
    const user = userEvent.setup();
    render(<EmployeeDetails employee={employee} canEdit />);

    await user.click(screen.getByLabelText('Employment Type'));
    await user.click(await screen.findByRole('option', { name: 'Contract' }));

    expect(screen.getByLabelText('Contract Expiry Date')).toHaveTextContent('Not set');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(toast.error).toHaveBeenCalledWith(
      'Contract expiry date is required for contract employment',
    );
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('PATCHes the switch back to permanent without an expiry — the API clears it', async () => {
    const user = userEvent.setup();
    render(<EmployeeDetails employee={contractor} canEdit />);

    await user.click(screen.getByLabelText('Employment Type'));
    await user.click(await screen.findByRole('option', { name: 'Permanent' }));

    expect(screen.queryByLabelText('Contract Expiry Date')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/v1/people/mem_1', {
        employmentType: 'permanent',
      });
    });
  });

  it('disables the employment fields for read-only users', () => {
    render(<EmployeeDetails employee={contractor} canEdit={false} />);

    expect(screen.getByLabelText('Employment Type')).toBeDisabled();
    expect(screen.getByLabelText('Contract Expiry Date')).toBeDisabled();
  });
});
