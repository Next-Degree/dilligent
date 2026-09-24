/**
 * People-directory access for the Vercel access-review checks.
 *
 * Mirrors the GitHub manifest's `loadDirectoryByEmail` (see
 * `manifests/github/checks/org-accounts.ts`): both answer the same question —
 * "is this provider account a person we employ?" — and both must degrade the
 * same way when the host supplies no directory.
 */

import type { CheckContext, DirectoryPerson } from '../../types';

/**
 * Provider slugs whose linked email identifies a person on Vercel.
 *
 * Deliberately NOT `'vercel'`, which is what mirroring the GitHub helper
 * literally would give. Two reasons:
 *
 *   1. `EXTERNAL_USER_SOURCES` in the API is `['github']` — GitHub is the only
 *      provider a People record can link an email for today, so filtering on
 *      `'vercel'` would match nothing on every run.
 *   2. It is the right address regardless. Vercel accounts are overwhelmingly
 *      created by signing in with GitHub, so a person's GitHub email IS their
 *      Vercel identity — which is exactly why the reviewer asked for it.
 *
 * Add `'vercel'` here if the People record ever supports linking one directly.
 */
const DIRECTORY_SOURCES = new Set(['github', 'vercel']);

export interface VercelDirectory {
  /** False when the host supplied no directory, or reading it failed. */
  available: boolean;
  /** Every email that identifies a person on Vercel, mapped to that person. */
  byEmail: Map<string, DirectoryPerson>;
  /** How many people the directory returned. */
  total: number;
}

const normalizeEmail = (value: string | null | undefined): string | null =>
  value?.trim().toLowerCase() || null;

/**
 * Load the People directory keyed by every email that identifies a person on
 * Vercel: their primary work email, plus any Vercel email an admin linked to
 * their People record.
 *
 * Returns `available: false` when the host supplied no directory, so callers can
 * decide for themselves whether to degrade to provider-only evidence or report
 * the comparison as unverified. An empty map must never be read as "nobody
 * works here" — that would turn a lookup failure into a finding against every
 * account.
 */
export async function loadDirectoryByEmail(ctx: CheckContext): Promise<VercelDirectory> {
  if (!ctx.directory) {
    ctx.warn(
      'No People directory available in this run; reporting Vercel accounts without directory comparison.',
    );
    return { available: false, byEmail: new Map(), total: 0 };
  }

  try {
    const people = await ctx.directory.listPeople();
    const byEmail = new Map<string, DirectoryPerson>();
    let linkedCount = 0;

    for (const person of people) {
      const emails = [
        person.email,
        // Only emails linked for a provider that identifies someone on Vercel.
        // An address linked for, say, Okta says nothing about who owns a Vercel
        // account, and matching on it would attribute an account to the wrong
        // person.
        ...(person.linkedEmails ?? [])
          .filter((linked) => DIRECTORY_SOURCES.has(linked.source))
          .map((linked) => linked.email),
      ];

      for (const raw of emails) {
        const email = normalizeEmail(raw);
        if (!email) continue;

        const existing = byEmail.get(email);
        if (existing && existing.id !== person.id) {
          // An active record wins a collision, rather than the GitHub helper's
          // first-writer-wins. `listPeople()` has no guaranteed ordering, so
          // "first" is arbitrary; deciding on employment status is stable across
          // runs and gets the case that matters right — a rehire, or an address
          // recycled to a new joiner, must not resolve to the archived record
          // and read as a leaver with lingering access.
          if (existing.isActive || !person.isActive) {
            ctx.warn(
              `Directory email ${email} maps to more than one person; keeping the active match.`,
            );
            continue;
          }
        }

        byEmail.set(email, person);
        if (email !== person.email) linkedCount++;
      }
    }

    ctx.log(
      `Loaded ${people.length} people from the directory (${linkedCount} linked Vercel email(s))`,
    );
    return { available: true, byEmail, total: people.length };
  } catch (error) {
    ctx.warn(`Could not read the People directory: ${String(error)}`);
    return { available: false, byEmail: new Map(), total: 0 };
  }
}
