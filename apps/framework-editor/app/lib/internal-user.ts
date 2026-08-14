/**
 * Shared (client + server safe) rules for who may use the Framework Editor.
 *
 * Kept out of utils.ts so client components can import it without pulling in
 * `next/headers`.
 */

export const ALLOWED_DOMAIN = 'trycomp.ai';

export function isInternalUser(email: string): boolean {
  const parts = email.split('@');
  return parts.length === 2 && parts[1] === ALLOWED_DOMAIN;
}
