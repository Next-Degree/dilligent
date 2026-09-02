import type { BrowserStepAuthMode } from '@db';

/**
 * The runtime vocabulary for a step's auth mode.
 *
 * Prisma's generated enum object would work here, but importing it pulls the
 * generated client in at module load — which drags a live DATABASE_URL into
 * every unit test that only wanted the constant. These literals stay provably
 * in lockstep with the schema instead: the `satisfies` clause fails to compile
 * if `BrowserStepAuthMode` gains, loses, or renames a member.
 */
export const BROWSER_STEP_AUTH_MODES = {
  saved_session: 'saved_session',
  public: 'public',
} satisfies Record<BrowserStepAuthMode, BrowserStepAuthMode>;

/** Reuses the connection's logged-in browser context — today's behavior. */
export const SAVED_SESSION_AUTH_MODE = BROWSER_STEP_AUTH_MODES.saved_session;

/** Runs on a throwaway, non-persistent session with no login. */
export const PUBLIC_AUTH_MODE = BROWSER_STEP_AUTH_MODES.public;

/** True when this step runs without a login, on a throwaway session. */
export function isPublicAuthMode(
  authMode: BrowserStepAuthMode | null | undefined,
): boolean {
  return authMode === PUBLIC_AUTH_MODE;
}
