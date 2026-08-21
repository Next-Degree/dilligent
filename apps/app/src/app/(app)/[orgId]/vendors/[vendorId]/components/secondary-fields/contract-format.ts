import { VendorContractTerm, VendorCostModel } from '@db';

export function centsToDollars(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined) return null;
  return cents / 100;
}

export function dollarsToCents(dollars: number | null | undefined): number | null {
  if (dollars === null || dollars === undefined) return null;
  return Math.round(dollars * 100);
}

export function parseNumberInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toInputValue(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function dateToUtcDateOnly(date: Date | null | undefined): string | null {
  if (!date) return null;
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}

export function utcDateOnlyToDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

export function costUnitLabel({
  costModel,
  contractTerm,
}: {
  costModel?: VendorCostModel | null;
  contractTerm?: VendorContractTerm | null;
}): string {
  const seat = costModel === VendorCostModel.per_seat ? '/seat' : '';
  const period =
    contractTerm === VendorContractTerm.monthly
      ? '/mo'
      : contractTerm === VendorContractTerm.yearly
        ? '/yr'
        : '';
  return `${seat}${period}`;
}
