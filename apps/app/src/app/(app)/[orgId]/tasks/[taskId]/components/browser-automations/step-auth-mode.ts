import type { BrowserStepAuthMode } from '../../hooks/types';

/** Reuses a connection's logged-in browser context — the long-standing behavior. */
export const SAVED_SESSION_MODE: BrowserStepAuthMode = 'saved_session';

/** Runs on a throwaway session with no login, for a page that needs none. */
export const PUBLIC_MODE: BrowserStepAuthMode = 'public';

/**
 * Mirrors `isPublicStep` on the API side, deliberately by name: a public step
 * runs on no connection, and every surface that maps steps to connections has
 * to apply that rule or it re-derives the wrong default.
 */
export function isPublicStep(step: { authMode?: BrowserStepAuthMode | null }): boolean {
  return step.authMode === PUBLIC_MODE;
}

export const AUTH_MODE_LABELS: Record<BrowserStepAuthMode, string> = {
  saved_session: 'Saved connection',
  public: 'Public page — no login',
};

/**
 * Whether a user-entered target URL is usable as a starting point. Deliberately
 * permissive — the API re-validates with the same URL-safety rules every other
 * target URL goes through — but it does catch the two mistakes the composer can
 * see: an empty field, and a non-web scheme the run could never open.
 */
export function isUsableTargetUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
