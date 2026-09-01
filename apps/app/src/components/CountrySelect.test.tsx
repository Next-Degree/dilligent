import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CountrySelect, formatCountry } from './CountrySelect';

// jsdom doesn't implement the pointer APIs the base-ui combobox relies on.
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

describe('CountrySelect', () => {
  it('shows the selected country by name and code', () => {
    render(<CountrySelect value="US" onChange={vi.fn()} id="loc" />);

    expect(screen.getByRole('combobox')).toHaveValue('United States (US)');
  });

  it('is empty when no country is set', () => {
    render(<CountrySelect value={null} onChange={vi.fn()} />);

    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('filters by country name and reports the picked code', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<CountrySelect value={null} onChange={handleChange} />);

    await user.type(screen.getByRole('combobox'), 'brazi');
    await user.click(await screen.findByRole('option', { name: 'Brazil (BR)' }));

    expect(handleChange).toHaveBeenCalledWith('BR');
  });

  it('filters by country code too', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<CountrySelect value={null} onChange={handleChange} />);

    await user.type(screen.getByRole('combobox'), '(GB)');
    await user.click(await screen.findByRole('option', { name: 'United Kingdom (GB)' }));

    expect(handleChange).toHaveBeenCalledWith('GB');
  });

  it('disables the input for read-only users', () => {
    render(<CountrySelect value="US" onChange={vi.fn()} disabled />);

    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});

describe('formatCountry', () => {
  it('renders a known code as name plus code', () => {
    expect(formatCountry('BR')).toBe('Brazil (BR)');
    expect(formatCountry('gb')).toBe('United Kingdom (GB)');
  });

  it('renders a dash when no country is set', () => {
    expect(formatCountry(null)).toBe('—');
    expect(formatCountry('')).toBe('—');
  });

  // A code that predates the current ISO list shouldn't render as a blank cell.
  it('falls back to the raw value for an unknown code', () => {
    expect(formatCountry('XX')).toBe('XX');
  });
});
