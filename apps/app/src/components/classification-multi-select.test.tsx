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

  it("shows each option's description and ties it to that checkbox", () => {
    renderSelect({
      options: [
        { value: 'people_data', label: 'People Data', description: 'Records about individuals.' },
        {
          value: 'company_data',
          label: 'Company Data',
          description: 'Records about organisations.',
        },
      ],
    });

    expect(screen.getByText('Records about individuals.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'People Data' })).toHaveAccessibleDescription(
      'Records about individuals.',
    );
    // Each description belongs to its own option, not the group.
    expect(screen.getByRole('checkbox', { name: 'Company Data' })).toHaveAccessibleDescription(
      'Records about organisations.',
    );
  });

  it('omits the description element for options without one', () => {
    renderSelect();

    expect(screen.getByRole('checkbox', { name: 'SaaS' })).not.toHaveAccessibleDescription();
  });

  it('groups sectioned options under their heading, leaving unsectioned ones loose', () => {
    renderSelect({
      label: 'Data Service Types',
      options: [
        { value: 'people_data', label: 'People Data', section: 'Kinds of data' },
        { value: 'company_data', label: 'Company Data', section: 'Kinds of data' },
        { value: 'matching', label: 'Matching', section: 'What the vendor does with it' },
        { value: 'other', label: 'Other' },
      ],
    });

    const kinds = screen.getByRole('group', { name: 'Kinds of data' });
    expect(within(kinds).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(kinds).getByRole('checkbox', { name: 'People Data' })).toBeInTheDocument();

    const operations = screen.getByRole('group', { name: 'What the vendor does with it' });
    expect(within(operations).getAllByRole('checkbox')).toHaveLength(1);

    // `other` spans both questions, so it sits under neither heading.
    expect(within(kinds).queryByRole('checkbox', { name: 'Other' })).not.toBeInTheDocument();
    expect(within(operations).queryByRole('checkbox', { name: 'Other' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Other' })).toBeInTheDocument();

    // The outer group still owns every option, sectioned or not.
    const all = screen.getByRole('group', { name: 'Data Service Types' });
    expect(within(all).getAllByRole('checkbox')).toHaveLength(4);
  });

  it('renders no headings for a vocabulary that asks a single question', () => {
    renderSelect();

    expect(screen.getAllByRole('group')).toHaveLength(1);
  });

  it('survives a value that is not an array', () => {
    renderSelect({ value: undefined as unknown as string[] });

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'SaaS' })).not.toBeChecked();
  });
});
