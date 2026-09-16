'use client';

import {
  getCountryLabel,
  getCountryOptions,
  isCountryCode,
  type CountryOption,
} from '@/lib/countries';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@trycompai/design-system';
import { useMemo } from 'react';

interface CountrySelectProps {
  /** ISO 3166-1 alpha-2 code, or null when no country is set. */
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Ties the control to its <Label htmlFor>. */
  id?: string;
}

/**
 * Searchable country picker over the full ISO 3166-1 alpha-2 list — 249 options
 * are too many to scroll, so the combobox filters as you type. Each option's
 * label carries both the name and the code ("United States (US)"), so typing
 * either one finds the country.
 */
export function CountrySelect({
  value,
  onChange,
  disabled = false,
  placeholder = 'Search countries',
  id,
}: CountrySelectProps) {
  const options = useMemo(() => getCountryOptions(), []);
  const selected = useMemo(
    () => options.find((option) => option.value === value?.toUpperCase()) ?? null,
    [options, value],
  );

  const handleValueChange = (next: CountryOption | null) => {
    onChange(next?.value ?? null);
  };

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={handleValueChange}
      disabled={disabled}
    >
      <ComboboxInput id={id} placeholder={placeholder} disabled={disabled} showClear />
      <ComboboxContent>
        <ComboboxEmpty>No countries found</ComboboxEmpty>
        <ComboboxList>
          {(option: CountryOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** "US" → "United States (US)"; a blank/unknown code renders as a dash. */
export function formatCountry(value: string | null | undefined): string {
  if (!value) return '—';
  return isCountryCode(value) ? getCountryLabel(value) : value;
}
