/**
 * People-directory access for the Trigger.dev access checks, plus the
 * corporate-domain fallback derived from it.
 */

import type { CheckContext } from '../../types';
import { loadPeopleDirectory, normalizeEmail, type PeopleDirectory } from '../people-directory';

/**
 * Linked-email sources that identify a person on Trigger.dev. Most Trigger.dev accounts
 * are created by signing in with GitHub, so a person's linked GitHub email is usually
 * their Trigger.dev identity. `trigger-dev` is listed for when People records can link
 * one directly.
 */
const DIRECTORY_SOURCES = ['github', 'trigger-dev'];

/**
 * Consumer mailbox providers. They never count as a corporate domain in the directory
 * fallback: one contractor on gmail.com in People must not approve every gmail.com
 * account on Trigger.dev, which are exactly the accounts the domain check exists to catch.
 */
const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'aol.com',
  'fastmail.com',
  'gmail.com',
  'gmx.com',
  'googlemail.com',
  'hey.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'qq.com',
  'yahoo.com',
  'yandex.com',
  'zoho.com',
]);

export interface TriggerDirectory extends PeopleDirectory {
  /**
   * Primary-email domains of active people, minus consumer mailbox providers: the
   * fallback for "corporate domains".
   */
  activeDomains: Set<string>;
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1);
}

export async function loadDirectory(ctx: CheckContext): Promise<TriggerDirectory> {
  const directory = await loadPeopleDirectory(ctx, {
    provider: 'Trigger.dev',
    sources: DIRECTORY_SOURCES,
  });

  const activeDomains = new Set<string>();
  for (const person of directory.people) {
    if (!person.isActive) continue;
    const domain = emailDomain(normalizeEmail(person.email));
    if (domain && !FREE_MAIL_DOMAINS.has(domain)) activeDomains.add(domain);
  }

  return { ...directory, activeDomains };
}
