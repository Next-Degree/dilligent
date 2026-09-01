import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateVendor = vi.fn().mockResolvedValue({ id: 'vnd_1' });
vi.mock('@/hooks/use-vendors', () => ({
  useVendorActions: () => ({ createVendor: mockCreateVendor }),
}));

vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('./VendorNameAutocompleteField', () => ({
  VendorNameAutocompleteField: ({
    form,
  }: {
    form: { setValue: (name: 'name', value: string) => void };
  }) => (
    <input aria-label="Name" onChange={(event) => form.setValue('name', event.target.value)} />
  ),
}));

vi.mock('@/components/SelectAssignee', () => ({
  SelectAssignee: () => <div />,
}));

// Radix Select does not open under jsdom; a native select keeps the option
// labels (which is what this suite is about) assertable.
vi.mock('@trycompai/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <select
      aria-label="Category or status"
      value={value ?? ''}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

import { CreateVendorForm } from './create-vendor-form';

function renderForm() {
  return render(<CreateVendorForm assignees={[]} organizationId="org-1" />);
}

/** The category control is the first of the two mocked native selects. */
function categorySelect() {
  return screen.getAllByLabelText('Category or status')[0];
}

describe('CreateVendorForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers active categories only, labelled from the shared vocabulary', () => {
    renderForm();

    expect(within(categorySelect()).getByRole('option', { name: 'HR & Recruiting' })).toBeInTheDocument();
    expect(
      within(categorySelect()).getByRole('option', { name: 'Cloud & Infrastructure' }),
    ).toBeInTheDocument();
    // Retired values must never be offered, even though they remain in the enum.
    expect(within(categorySelect()).queryByRole('option', { name: /retired/i })).toBeNull();
    expect(within(categorySelect()).queryByRole('option', { name: 'Cloud' })).toBeNull();
  });

  it('always asks for delivery models', () => {
    renderForm();

    expect(screen.getByRole('group', { name: 'Delivery Models' })).toBeInTheDocument();
  });

  it('hides the data dimensions until a data-centric category is chosen', async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByRole('group', { name: 'Data Service Types' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Data Flow Roles' })).toBeNull();

    await user.selectOptions(categorySelect(), 'data_provider');

    expect(await screen.findByRole('group', { name: 'Data Service Types' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Data Flow Roles' })).toBeInTheDocument();
  });

  it('hides them again when the category moves back to a non-data one', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(categorySelect(), 'data_enrichment');
    expect(await screen.findByRole('group', { name: 'Data Service Types' })).toBeInTheDocument();

    await user.selectOptions(categorySelect(), 'marketing');
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Data Service Types' })).toBeNull(),
    );
  });

  it('refuses to submit without a delivery model', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.selectOptions(categorySelect(), 'marketing');
    await user.click(screen.getByRole('button', { name: /create vendor/i }));

    expect(await screen.findByText('Select at least one delivery model')).toBeInTheDocument();
    expect(mockCreateVendor).not.toHaveBeenCalled();
  });

  it('submits the four classification dimensions together', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.selectOptions(categorySelect(), 'data_provider');

    const deliveryModels = screen.getByRole('group', { name: 'Delivery Models' });
    await user.click(within(deliveryModels).getByRole('checkbox', { name: 'API Service' }));

    const serviceTypes = await screen.findByRole('group', { name: 'Data Service Types' });
    await user.click(within(serviceTypes).getByRole('checkbox', { name: 'People Data' }));
    await user.click(within(serviceTypes).getByRole('checkbox', { name: 'Company Data' }));

    const flowRoles = screen.getByRole('group', { name: 'Data Flow Roles' });
    await user.click(within(flowRoles).getByRole('checkbox', { name: 'Source' }));
    await user.click(within(flowRoles).getByRole('checkbox', { name: 'Destination' }));

    await user.click(screen.getByRole('button', { name: /create vendor/i }));

    await waitFor(() => expect(mockCreateVendor).toHaveBeenCalled());
    expect(mockCreateVendor).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'data_provider',
        deliveryModels: ['api_service'],
        dataServiceTypes: ['people_data', 'company_data'],
        dataFlowRoles: ['source', 'destination'],
      }),
    );
  });
});
