import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VendorCategoryFilter } from './VendorCategoryFilter';

describe('VendorCategoryFilter', () => {
  it('labels the trigger with the number of active filters', () => {
    const { rerender } = render(<VendorCategoryFilter value={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Category' })).toBeInTheDocument();

    rerender(<VendorCategoryFilter value={['finance', 'sales']} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Category (2)' })).toBeInTheDocument();
  });

  it('offers only active categories, labelled from the shared vocabulary', async () => {
    const user = userEvent.setup();
    render(<VendorCategoryFilter value={[]} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Category' }));

    expect(await screen.findByRole('checkbox', { name: 'HR & Recruiting' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Cloud & Infrastructure' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'SaaS (retired)' })).not.toBeInTheDocument();
  });

  it('adds and clears selected categories', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VendorCategoryFilter value={['finance']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Category (1)' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Sales' }));
    expect(onChange).toHaveBeenCalledWith(['finance', 'sales']);

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
