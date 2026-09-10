import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm, type Control } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { VendorClassificationFields } from './vendor-classification-fields';

/**
 * The disclosure shipped as a bare underlined caption with no chevron, so a
 * closed section read as an empty one. These pin the affordance and the
 * category-driven layout switch.
 */
function Harness({ category }: { category: string }) {
  const form = useForm({
    defaultValues: {
      category,
      deliveryModels: [],
      dataServiceTypes: [],
      dataFlowRoles: [],
    },
  });

  return (
    <VendorClassificationFields
      control={form.control as unknown as Control<never>}
      disabled={false}
    />
  );
}

const DISCLOSURE = 'Data handling (optional)';

describe('VendorClassificationFields', () => {
  it('keeps the data dimensions closed but visibly expandable for a non-data vendor', () => {
    render(<Harness category="cloud_infrastructure" />);

    const trigger = screen.getByRole('button', { name: DISCLOSURE });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('data-panel-open');
    expect(screen.queryByText('Data Service Types')).not.toBeInTheDocument();
  });

  it('reveals both data dimensions when the disclosure is opened', async () => {
    const user = userEvent.setup();
    render(<Harness category="cloud_infrastructure" />);

    await user.click(screen.getByRole('button', { name: DISCLOSURE }));

    // The chevron rotates off this attribute, so it is the affordance's contract.
    expect(screen.getByRole('button', { name: DISCLOSURE })).toHaveAttribute('data-panel-open');
    expect(screen.getByText('Data Service Types')).toBeInTheDocument();
    expect(screen.getByText('Data Flow Roles')).toBeInTheDocument();
  });

  it('shows the data dimensions outright for a data-centric vendor', () => {
    render(<Harness category="data_provider" />);

    expect(screen.queryByRole('button', { name: DISCLOSURE })).not.toBeInTheDocument();
    expect(screen.getByText('Data Service Types')).toBeInTheDocument();
    expect(screen.getByText('Data Flow Roles')).toBeInTheDocument();
  });

  it('explains each data option rather than leaving the label to speak for itself', async () => {
    const user = userEvent.setup();
    render(<Harness category="data_provider" />);

    expect(screen.getByRole('checkbox', { name: 'People Data' })).toHaveAccessibleDescription(
      /Records about individual people the vendor supplies/,
    );
    expect(screen.getByRole('checkbox', { name: 'Source' })).toHaveAccessibleDescription(
      /Data originates with the vendor/,
    );

    // The group copy carries the distinction the per-option text cannot: this is
    // the vendor's data product, not our own tenants and users.
    expect(screen.getByRole('group', { name: 'Data Service Types' })).toHaveAccessibleDescription(
      /not the records we happen to store inside it/,
    );

    await user.click(screen.getByRole('checkbox', { name: 'People Data' }));
    expect(screen.getByRole('checkbox', { name: 'People Data' })).toBeChecked();
  });
});
