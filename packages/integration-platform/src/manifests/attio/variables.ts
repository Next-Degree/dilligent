import type { CheckVariable, CheckVariableValues } from '../../types';

export const maxAdminsVariable: CheckVariable = {
  id: 'max_admins',
  label: 'Maximum workspace admins',
  type: 'number',
  required: false,
  placeholder: '3',
  helpText:
    'Raise an access-review finding when the Attio workspace has more admins than this. ' +
    'Leave empty to record admin counts as evidence without a threshold.',
};

/**
 * Parses the `max_admins` threshold. Returns null when unset or nonsensical (negative,
 * fractional, non-numeric) so the caller records evidence without raising a finding
 * rather than acting on a value the customer did not mean.
 */
export function parseMaxAdmins(variables: CheckVariableValues | undefined): number | null {
  const raw = variables?.max_admins;

  // A blank field must read as "no threshold", not as a threshold of zero. Number('')
  // is 0, which would otherwise pass the integer check below and fail every workspace
  // that has any admin at all — inventing the exact policy this function avoids.
  if (typeof raw === 'string' && raw.trim() === '') return null;

  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;

  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}
