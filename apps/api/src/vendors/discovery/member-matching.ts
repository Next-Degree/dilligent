import type { ObservedGrantee } from './grant-reconciler';

export interface MatchableMember {
  id: string;
  externalUserId: string | null;
  email: string | null;
}

export interface MemberMatchResult {
  /** Grantee user key (or email fallback) -> member id. */
  memberIdByGrantee: Map<string, string>;
  /** Grantees that matched nobody. Reported, never silently dropped. */
  unmatched: ObservedGrantee[];
}

const granteeKey = (grantee: ObservedGrantee): string =>
  grantee.userKey || `email:${grantee.email.toLowerCase()}`;

/**
 * Attribute observed grantees to organization members.
 *
 * Prefers the provider's stable user id over email because email-only matching breaks on
 * aliases and +-addressing, and an alias silently attributing one person's access to nobody
 * is indistinguishable from that person having no access at all.
 *
 * Grantees matching no member are returned rather than discarded — usually a contractor or a
 * shared account, which is worth surfacing rather than losing.
 */
export function matchGranteesToMembers({
  grantees,
  members,
}: {
  grantees: ObservedGrantee[];
  members: MatchableMember[];
}): MemberMatchResult {
  const byExternalId = new Map<string, string>();
  const byEmail = new Map<string, string>();

  for (const member of members) {
    if (member.externalUserId) {
      byExternalId.set(member.externalUserId, member.id);
    }
    if (member.email) {
      byEmail.set(member.email.toLowerCase(), member.id);
    }
  }

  const memberIdByGrantee = new Map<string, string>();
  const unmatched: ObservedGrantee[] = [];

  for (const grantee of grantees) {
    const viaUserKey = grantee.userKey ? byExternalId.get(grantee.userKey) : undefined;
    const viaEmail = grantee.email ? byEmail.get(grantee.email.toLowerCase()) : undefined;
    const memberId = viaUserKey ?? viaEmail;

    if (!memberId) {
      unmatched.push(grantee);
      continue;
    }

    memberIdByGrantee.set(granteeKey(grantee), memberId);
  }

  return { memberIdByGrantee, unmatched };
}

export { granteeKey };
