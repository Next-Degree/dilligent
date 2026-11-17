export const OWNER_ROLE = 'owner';

/**
 * Parse a comma-separated role string into a clean list of role names.
 */
export function parseRoles(role: string | null | undefined): string[] {
  return (role ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}
