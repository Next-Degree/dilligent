import {
  ADMIN_PERMISSIONS,
  AUDITOR_PERMISSIONS,
  mockHasPermission,
  setMockPermissions,
} from '@/test-utils/mocks/permissions';
import type { Vendor } from '@db';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ permissions: {}, hasPermission: mockHasPermission }),
}));

const mockUpdateVendor = vi.fn().mockResolvedValue({});
vi.mock('@/hooks/use-vendors', () => ({
  useVendorActions: () => ({ updateVendor: mockUpdateVendor }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/SelectAssignee', () => ({
  SelectAssignee: ({
    assigneeId,
    onAssigneeChange,
    disabled,
    emptyLabel = 'Unassigned',
  }: {
    assigneeId: string | null;
    onAssigneeChange: (value: string | null) => void;
    disabled?: boolean;
    emptyLabel?: string;
  }) => (
    <select
      aria-label={emptyLabel}
      disabled={disabled}
      value={assigneeId ?? ''}
      onChange={(event) => onAssigneeChange(event.target.value || null)}
    >
      <option value="">{emptyLabel}</option>
      <option value="mem_owner">Dana Owner</option>
      <option value="mem_assignee">Sam Assignee</option>
    </select>
  ),
}));

vi.mock('@trycompai/design-system', () => ({
  Button: ({
    children,
    type,
    disabled,
  }: {
    children: ReactNode;
    type?: 'submit' | 'button';
    disabled?: boolean;
  }) => (
    <button type={type} disabled={disabled}>
      {children}
    </button>
  ),
  Checkbox: ({
    onCheckedChange,
    ...props
  }: {
    onCheckedChange?: (checked: boolean) => void;
  } & Omit<React.ComponentProps<'input'>, 'onChange' | 'type'>) => (
    <input
      type="checkbox"
      {...props}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
  Collapsible: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="data-handling-disclosure">{children}</div>
  ),
  CollapsibleTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  // role=group + aria-labelledby is how the multi-select names itself, so the
  // mock has to keep both or `getByRole('group', { name })` cannot work.
  Field: (props: React.ComponentProps<'div'>) => <div role="group" {...props} />,
  FieldDescription: ({ children, id }: { children: ReactNode; id?: string }) => (
    <p id={id}>{children}</p>
  ),
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  FieldError: ({ errors }: { errors?: Array<{ message?: string } | undefined> }) => (
    <>{errors?.map((error, i) => error?.message && <span key={i}>{error.message}</span>)}</>
  ),
  FieldLabel: ({
    children,
    htmlFor,
    id,
  }: {
    children: ReactNode;
    htmlFor?: string;
    id?: string;
  }) => (
    <label htmlFor={htmlFor} id={id}>
      {children}
    </label>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HStack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
  InputGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  InputGroupAddon: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  InputGroupInput: (props: React.ComponentProps<'input'>) => <input {...props} />,
  Section: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
  Stack: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid="ds-select"
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{typeof children === 'string' ? children : value}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock('@trycompai/design-system/icons', () => ({
  Calendar: () => <span data-testid="calendar-icon" />,
}));

vi.mock('@trycompai/ui/calendar', () => ({ Calendar: () => <div /> }));
vi.mock('@trycompai/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
}));

import { UpdateSecondaryFieldsForm } from './update-secondary-fields-form';

const vendor = {
  id: 'vnd_1',
  name: 'Acronis',
  description: 'Backup provider',
  category: 'collaboration_productivity',
  deliveryModels: ['saas'],
  dataServiceTypes: [],
  dataFlowRoles: [],
  status: 'assessed',
  website: 'https://acronis.com',
  isSubProcessor: false,
  assigneeId: 'mem_assignee',
  ownerId: 'mem_owner',
  totalSeats: 50,
  usedSeats: 42,
  renewalDate: new Date('2027-01-31T00:00:00.000Z'),
  costCents: 1_200_000,
  costModel: 'per_seat',
  contractTerm: 'yearly',
  noticePeriodDays: 30,
} as unknown as Vendor;

function renderForm(overrides: Record<string, unknown> = {}) {
  return render(<UpdateSecondaryFieldsForm vendor={{ ...vendor, ...overrides }} assignees={[]} />);
}

describe('UpdateSecondaryFieldsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMockPermissions(ADMIN_PERMISSIONS);
  });

  it('renders every vendor-management field, populated from the vendor', () => {
    renderForm();

    expect(screen.getByLabelText('Total Seats')).toHaveValue(50);
    expect(screen.getByLabelText('Used Seats')).toHaveValue(42);
    expect(screen.getByLabelText('Cost')).toHaveValue(12_000);
    expect(screen.getByLabelText('Notice Period')).toHaveValue(30);
    expect(screen.getByLabelText('Renewal Date')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Yearly' }).closest('select')).toHaveValue('yearly');
    expect(screen.getByLabelText('No owner')).toHaveValue('mem_owner');
  });

  it('splits the assessor and the system owner across the two sections', () => {
    renderForm();

    const compliance = screen.getByRole('region', { name: 'Compliance' });
    const management = screen.getByRole('region', { name: 'Vendor Management' });

    expect(within(compliance).getByLabelText('Unassigned')).toHaveValue('mem_assignee');
    expect(within(compliance).queryByLabelText('No owner')).not.toBeInTheDocument();

    expect(within(management).getByLabelText('No owner')).toHaveValue('mem_owner');
    expect(within(management).queryByLabelText('Unassigned')).not.toBeInTheDocument();
  });

  it('leaves unrecorded fields empty rather than showing zero', () => {
    renderForm({
      totalSeats: null,
      usedSeats: null,
      costCents: null,
      costModel: null,
      noticePeriodDays: null,
      renewalDate: null,
      contractTerm: null,
      ownerId: null,
    });

    expect(screen.getByLabelText('Total Seats')).toHaveValue(null);
    expect(screen.getByLabelText('Cost')).toHaveValue(null);
    expect(screen.getByLabelText('No owner')).toHaveValue('');
  });

  it('submits the contract fields, converting cost to cents', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText('Cost'));
    await user.type(screen.getByLabelText('Cost'), '13500.50');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateVendor).toHaveBeenCalled());
    expect(mockUpdateVendor).toHaveBeenCalledWith(
      'vnd_1',
      expect.objectContaining({
        totalSeats: 50,
        usedSeats: 42,
        costCents: 1_350_050,
        costModel: 'per_seat',
        contractTerm: 'yearly',
        noticePeriodDays: 30,
        ownerId: 'mem_owner',
        renewalDate: '2027-01-31T00:00:00.000Z',
      }),
    );
  });

  it('sends null for a field the user clears', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText('Total Seats'));
    await user.clear(screen.getByLabelText('Used Seats'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateVendor).toHaveBeenCalled());
    expect(mockUpdateVendor).toHaveBeenCalledWith(
      'vnd_1',
      expect.objectContaining({ totalSeats: null, usedSeats: null }),
    );
  });

  it('shows the cost unit so the number is unambiguous', () => {
    renderForm();
    expect(screen.getByText('/seat/yr')).toBeInTheDocument();
  });

  it('shows only the period for a flat-fee vendor', () => {
    renderForm({ costModel: 'fixed', contractTerm: 'monthly' });
    expect(screen.getByText('/mo')).toBeInTheDocument();
    expect(screen.queryByText('/seat/mo')).not.toBeInTheDocument();
  });

  it('blocks a save where a cost has no contract term to give it a period', async () => {
    const user = userEvent.setup();
    renderForm({ contractTerm: null });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Choose a contract term so the cost has a period'),
    ).toBeInTheDocument();
    expect(mockUpdateVendor).not.toHaveBeenCalled();
  });

  it('blocks a save where used seats exceed total seats', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.clear(screen.getByLabelText('Used Seats'));
    await user.type(screen.getByLabelText('Used Seats'), '99');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Used seats cannot exceed total seats')).toBeInTheDocument();
    expect(mockUpdateVendor).not.toHaveBeenCalled();
  });

  it('hides Save and disables the fields for a read-only user', () => {
    setMockPermissions(AUDITOR_PERMISSIONS);
    renderForm();

    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Total Seats')).toBeDisabled();
    expect(screen.getByLabelText('Cost')).toBeDisabled();
    expect(screen.getByLabelText('Renewal Date')).toBeDisabled();
    expect(screen.getByLabelText('No owner')).toBeDisabled();
  });
});
