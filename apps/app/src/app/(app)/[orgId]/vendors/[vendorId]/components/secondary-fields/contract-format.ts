/**
 * The API stores `annualCostCents` in minor units; the form works in dollars,
 * which is what people read off an invoice.
 */
export function centsToDollars(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

export function dollarsToCents(dollars: number | null | undefined): number | null {
  if (dollars === null || dollars === undefined) return null;
  return Math.round(dollars * 100);
}

/**
 * Number inputs report `''` when emptied — that means "not recorded", which is
 * `null`, not `0`. `valueAsNumber` gives `NaN` for a partially typed value
 * (`'-'`, `'1e'`), which also maps to null rather than a validation error the
 * user can't act on mid-keystroke.
 */
export function parseNumberInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Renders a nullable number back into an input's `value`. */
export function toInputValue(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * `renewalDate` is a calendar date living in a `DateTime` column. The picker
 * hands back local midnight, so a naive `.toISOString()` from UTC+10 stores
 * the *previous* day and every UTC reader sees the wrong date. Pinning the
 * picked y/m/d to UTC midnight keeps the stored value the date the user
 * actually chose, whatever their timezone.
 */
export function dateToUtcDateOnly(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}

/** Inverse of `dateToUtcDateOnly` — local midnight on the stored date. */
export function utcDateOnlyToDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}
