/** A date as the portal shows it next to a status, e.g. "Dec 15, 2026". */
export function formatShortDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
