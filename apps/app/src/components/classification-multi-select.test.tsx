import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ClassificationMultiSelect } from './classification-multi-select';

const options = [
  { value: 'saas', label: 'SaaS' },
  { value: 'api_service', label: 'API Service' },
  { value: 'open_source', label: 'Open Source' },
];

function renderSelect(overrides: Partial<React.ComponentProps<typeof ClassificationMultiSelect>> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <ClassificationMultiSelect
      id="delivery"
      label="Delivery Models"
      options={options}
      value={[]}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...utils, onChange };
}

describe('ClassificationMultiSelect', () => {
  it('renders one checkbox per option, named by its label', () => {
    renderSelect();

    const group = screen.getByRole('group', { name: 'Delivery Models' });
    expect(within(group).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(group).getByRole('checkbox', { name: 'SaaS' })).toBeInTheDocument();
    expect(within(group).getByRole('checkbox', { name: 'Open Source' })).toBeInTheDocument();
  });

  it('reflects the current selection', () => {
    renderSelect({ value: ['api_service'] });

    expect(screen.getByRole('checkbox', { name: 'API Service' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'SaaS' })).not.toBeChecked();
  });

  it('adds a value when an unchecked option is ticked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect({ value: ['saas'] });

    await user.click(screen.getByRole('checkbox', { name: 'Open Source' }));

    expect(onChange).toHaveBeenCalledWith(['saas', 'open_source']);
  });

  it('removes a value when a checked option is unticked', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect({ value: ['saas', 'open_source'] });

    await user.click(screen.getByRole('checkbox', { name: 'SaaS' }));

    expect(onChange).toHaveBeenCalledWith(['open_source']);
  });

  it('exposes the description to assistive tech', () => {
    renderSelect({ description: 'How we consume this vendor.' });

    expect(screen.getByRole('group', { name: 'Delivery Models' })).toHaveAccessibleDescription(
      'How we consume this vendor.',
    );
  });

  it('disables every option and reports no change when disabled', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect({ disabled: true, value: ['saas'] });

    // The design-system Checkbox renders a span with role=checkbox, so the
    // disabled state lands on aria-disabled rather than the DOM `disabled` prop.
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toHaveAttribute('aria-disabled', 'true');
    }

    await user.click(screen.getByRole('checkbox', { name: 'Open Source' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('survives a value that is not an array', () => {
    renderSelect({ value: undefined as unknown as string[] });

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'SaaS' })).not.toBeChecked();
  });
});
