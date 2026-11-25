/** Quotes a CSV field and neutralises spreadsheet formula injection. */
export function toCsvField(value: string | null | undefined): string {
  if (!value) return '';
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsvRow(values: Array<string | null | undefined>): string {
  return values.map(toCsvField).join(',');
}
