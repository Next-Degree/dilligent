/**
 * People-directory access for the Trigger.dev access checks.
 *
 * Mirrors the Vercel manifest's helper: both answer "is this provider account a person
 * we employ?" and must degrade the same way when the host supplies no directory.
 */

import type { CheckContext, DirectoryPerson } from '../../types';

/**
 * Linked-email sources that identify a person on Trigger.dev. Most Trigger.dev accounts
 * are created by signing in with GitHub, so a person's linked GitHub email is usually
 * their Trigger.dev identity. `trigger-dev` is listed for when People records can link
 * one directly.
 */
const DIRECTORY_SOURCES = new Set(['github', 'trigger-dev']);

export interface TriggerDirectory {
  /** False when the host supplied no directory, or reading it failed. */
  available: boolean;
  byEmail: Map<string, DirectoryPerson>;
  /** Primary-email domains of active people, the fallback for "corporate domains". */
  activeDomains: Set<string>;
}

const UNAVAILABLE: TriggerDirectory = {
  available: false,
  byEmail: new Map(),
  activeDomains: new Set(),
};

export const normalizeEmail = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1);
}

/**
 * Returns `available: false` when there is no directory. An empty map must never be
 * read as "nobody works here" — that would turn a lookup failure into a finding
 * against every account.
 */
export async function loadDirectory(ctx: CheckContext): Promise<TriggerDirectory> {
  if (!ctx.directory) {
    ctx.warn('No People directory available in this run.');
    return UNAVAILABLE;
  }

  try {
    const people = await ctx.directory.listPeople();
    const byEmail = new Map<string, DirectoryPerson>();
    const activeDomains = new Set<string>();

    for (const person of people) {
      if (person.isActive) {
        const domain = emailDomain(normalizeEmail(person.email));
        if (domain) activeDomains.add(domain);
      }

      const emails = [
        person.email,
        ...(person.linkedEmails ?? [])
          .filter((linked) => DIRECTORY_SOURCES.has(linked.source))
          .map((linked) => linked.email),
      ];

      for (const raw of emails) {
        const email = normalizeEmail(raw);
        if (!email) continue;
        // An active record wins a collision: a rehire, or an address recycled to a new
        // joiner, must not resolve to the archived record and read as a leaver.
        const existing = byEmail.get(email);
        if (existing && existing.id !== person.id && (existing.isActive || !person.isActive)) {
          continue;
        }
        byEmail.set(email, person);
      }
    }

    ctx.log(`Loaded ${people.length} people from the directory`);
    return { available: true, byEmail, activeDomains };
  } catch (error) {
    ctx.warn(`Could not read the People directory: ${String(error)}`);
    return UNAVAILABLE;
  }
}
