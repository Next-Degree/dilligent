import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddVendorToChecklist } from './AddVendorToChecklist';

let mockVendors: Array<{ id: string; name: string }> = [];

vi.mock('@/hooks/use-vendors', () => ({
  useVendors: () => ({
    data: { data: { data: mockVendors, count: mockVendors.length }, status: 200 },
  }),
}));

describe('AddVendorToChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVendors = [
      { id: 'vnd_1', name: 'Slack' },
      { id: 'vnd_2', name: 'AWS' },
    ];
  });

  it('offers vendors the checklist does not already list', async () => {
    // Scoping to observed access leaves out anything signed up for with a password, so a
    // reviewer must still be able to record those.
    render(<AddVendorToChecklist listedVendorIds={['vnd_1']} onAdd={vi.fn()} />);

    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByText('AWS')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Slack' })).not.toBeInTheDocument();
  });

  it('adds the selected vendor', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddVendorToChecklist listedVendorIds={[]} onAdd={onAdd} />);

    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByText('AWS'));
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onAdd).toHaveBeenCalledWith('vnd_2');
  });

  it('keeps the add button inert until something is chosen', () => {
    render(<AddVendorToChecklist listedVendorIds={[]} onAdd={vi.fn()} />);

    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
  });

  it('renders nothing when every vendor is already listed', () => {
    // An empty picker is worse than no picker.
    const { container } = render(
      <AddVendorToChecklist listedVendorIds={['vnd_1', 'vnd_2']} onAdd={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('is disabled while another row is being processed', () => {
    render(<AddVendorToChecklist listedVendorIds={[]} onAdd={vi.fn()} disabled />);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
