/**
 * People-directory access for the Railway employee access check.
 *
 * Mirrors the Vercel and Trigger.dev helpers: answer "is this Railway account a
 * person we employ?" and degrade the same way when the host supplies no
 * directory. Railway accounts are commonly created by signing in with GitHub,
 * so a person's linked GitHub email counts as their Railway identity.
 */

import type { CheckContext, DirectoryPerson } from '../../types';

const DIRECTORY_SOURCES = new Set(['github', 'railway']);

export interface RailwayDirectory {
  /** False when the host supplied no directory, or reading it failed. */
  available: boolean;
  byEmail: Map<string, DirectoryPerson>;
}

const UNAVAILABLE: RailwayDirectory = { available: false, byEmail: new Map() };

export const normalizeEmail = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * Returns `available: false` when there is no directory. An empty map must
 * never be read as "nobody works here".
 */
export async function loadDirectory(ctx: CheckContext): Promise<RailwayDirectory> {
  if (!ctx.directory) {
    ctx.warn('No People directory available in this run.');
    return UNAVAILABLE;
  }

  try {
    const people = await ctx.directory.listPeople();
    const byEmail = new Map<string, DirectoryPerson>();

    for (const person of people) {
      const emails = [
        person.email,
        ...(person.linkedEmails ?? [])
          .filter((linked) => DIRECTORY_SOURCES.has(linked.source))
          .map((linked) => linked.email),
      ];
      for (const raw of emails) {
        const email = normalizeEmail(raw);
        if (!email) continue;
        // An active record wins a collision: a rehire or a recycled address must
        // not resolve to the archived record and read as a leaver.
        const existing = byEmail.get(email);
        if (existing && existing.id !== person.id && (existing.isActive || !person.isActive)) {
          continue;
        }
        byEmail.set(email, person);
      }
    }

    ctx.log(`Loaded ${people.length} people from the directory`);
    return { available: true, byEmail };
  } catch (error) {
    ctx.warn(`Could not read the People directory: ${String(error)}`);
    return UNAVAILABLE;
  }
}
