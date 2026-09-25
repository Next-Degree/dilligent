/**
 * People-directory access shared by the access-review checks (Vercel,
 * Trigger.dev, Railway). Each answers "is this provider account a person we
 * employ?" and must degrade the same way when the host supplies no directory.
 *
 * Known divergence: the GitHub manifest still has its own `loadDirectoryByEmail`,
 * which resolves email collisions first-writer-wins. `listPeople()` is not
 * ordered, so that choice can flip between runs; moving GitHub onto this
 * helper is a follow-up because it changes GitHub's results.
 */

import type { CheckContext, DirectoryPerson } from '../types';

export interface PeopleDirectory {
  /** False when the host supplied no directory, or reading it failed. */
  available: boolean;
  /** Every email that identifies a person on the provider, mapped to that person. */
  byEmail: Map<string, DirectoryPerson>;
  /** Everyone the directory returned. */
  people: DirectoryPerson[];
}

export interface PeopleDirectoryOptions {
  /** Provider display name, used in log and warning messages. */
  provider: string;
  /**
   * Linked-email sources that identify a person on the provider. An address
   * linked for, say, Okta says nothing about who owns an account elsewhere,
   * and matching on it would attribute the account to the wrong person.
   */
  sources: readonly string[];
}

export const normalizeEmail = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const unavailable = (): PeopleDirectory => ({
  available: false,
  byEmail: new Map(),
  people: [],
});

/**
 * Load the People directory keyed by every email that identifies a person on
 * the provider: their primary work email, plus any linked email from one of
 * `sources`.
 *
 * Returns `available: false` when there is no directory, so callers decide for
 * themselves whether to degrade or report the comparison as unverified. An
 * empty map must never be read as "nobody works here": that would turn a
 * lookup failure into a finding against every account.
 */
export async function loadPeopleDirectory(
  ctx: CheckContext,
  { provider, sources }: PeopleDirectoryOptions,
): Promise<PeopleDirectory> {
  if (!ctx.directory) {
    ctx.warn(
      `No People directory available in this run; ${provider} accounts cannot be compared against it.`,
    );
    return unavailable();
  }

  try {
    const people = await ctx.directory.listPeople();
    const allowedSources = new Set(sources);
    const byEmail = new Map<string, DirectoryPerson>();
    const collisions = new Set<string>();
    let linkedCount = 0;

    for (const person of people) {
      const primary = normalizeEmail(person.email);
      const emails = [
        primary,
        ...(person.linkedEmails ?? [])
          .filter((linked) => allowedSources.has(linked.source))
          .map((linked) => linked.email),
      ];

      for (const raw of emails) {
        const email = normalizeEmail(raw);
        if (!email) continue;

        // An active record wins a collision. `listPeople()` has no guaranteed
        // ordering, so first-writer-wins would be arbitrary; deciding on
        // employment status is stable across runs, and a rehire or an address
        // recycled to a new joiner must not resolve to the archived record and
        // read as a leaver with lingering access.
        const existing = byEmail.get(email);
        if (existing && existing.id !== person.id) {
          collisions.add(email);
          if (existing.isActive || !person.isActive) continue;
        }

        byEmail.set(email, person);
        if (email !== primary) linkedCount++;
      }
    }

    if (collisions.size > 0) {
      ctx.warn(
        `${collisions.size} directory email(s) map to more than one person; keeping the active match for each (the first seen when both are active).`,
        { emails: [...collisions].slice(0, 20) },
      );
    }

    ctx.log(
      `Loaded ${people.length} people from the directory (${linkedCount} linked ${provider} email(s))`,
    );
    return { available: true, byEmail, people };
  } catch (error) {
    ctx.warn(`Could not read the People directory: ${String(error)}`);
    return unavailable();
  }
}
