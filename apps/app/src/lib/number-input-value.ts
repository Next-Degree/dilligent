/**
 * Converts a number input's raw string into the value stored for a check
 * variable. A cleared field stays '' so the check falls back to its default;
 * coercing it with Number('') would store 0, which some checks treat as a
 * meaningful setting (e.g. Dependabot SLA strict mode).
 */
export const numberInputValue = (raw: string): number | '' => (raw === '' ? '' : Number(raw));
