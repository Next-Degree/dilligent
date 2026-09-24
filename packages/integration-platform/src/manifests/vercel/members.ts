import type { CheckContext } from '../../types';
import type { VercelEmailInviteCode, VercelTeamMember, VercelTeamMembersResponse } from './types';

const MEMBERS_PAGE_SIZE = 100;
const MAX_MEMBER_PAGES = 20;

/** Roles that can change team membership, billing or security settings. */
const PRIVILEGED_ROLES = new Set(['OWNER', 'SECURITY']);

export interface VercelTeamRoster {
  members: VercelTeamMember[];
  emailInviteCodes: VercelEmailInviteCode[];
}

/**
 * Fetch every team member. Vercel paginates members with a cursor timestamp
 * returned as `pagination.next`, passed back as `until`; the loop runs until
 * `next` is no longer a number.
 */
export async function fetchVercelTeamRoster(
  ctx: CheckContext,
  teamId: string,
): Promise<VercelTeamRoster> {
  const members: VercelTeamMember[] = [];
  const emailInviteCodes: VercelEmailInviteCode[] = [];
  const seenMembers = new Set<string>();
  const seenInvites = new Set<string>();
  let until: number | undefined;

  for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(MEMBERS_PAGE_SIZE) });
    if (typeof until === 'number') {
      params.set('until', String(until));
    }

    const response = await ctx.fetch<VercelTeamMembersResponse>(
      `/v3/teams/${encodeURIComponent(teamId)}/members?${params.toString()}`,
    );

    for (const member of response.members ?? []) {
      if (!seenMembers.has(member.uid)) {
        seenMembers.add(member.uid);
        members.push(member);
      }
    }

    // Invite codes repeat across pages on some API versions — dedupe by id.
    for (const invite of response.emailInviteCodes ?? []) {
      if (!seenInvites.has(invite.id)) {
        seenInvites.add(invite.id);
        emailInviteCodes.push(invite);
      }
    }

    const next = response.pagination?.next;
    if (typeof next !== 'number') {
      break;
    }
    until = next;
  }

  return { members, emailInviteCodes };
}

/**
 * Lowercased, trimmed email — the join key person-scoped check results use to
 * match Vercel accounts to org members. Null when the account has no email.
 */
export function normalizeEmail(email: string | undefined | null): string | null {
  const normalized = email?.toLowerCase().trim();
  return normalized ? normalized : null;
}

export function getEmailDomain(email: string): string | null {
  const domain = email.split('@')[1]?.trim();
  return domain ? domain : null;
}

export function getEmailLocalPart(email: string): string | null {
  const local = email.split('@')[0]?.trim();
  return local ? local : null;
}

export function isPrivilegedRole(role: string | undefined): boolean {
  return PRIVILEGED_ROLES.has((role ?? '').toUpperCase());
}

/** Display name for findings — never the raw uid when something better exists. */
export function describeMember(member: VercelTeamMember): string {
  return member.name || member.username || normalizeEmail(member.email) || member.uid;
}

/**
 * True when the account was provisioned through (or linked to) the team's
 * identity provider, which is what makes removal in the IdP remove Vercel
 * access too.
 */
export function isCentrallyManaged(member: VercelTeamMember): boolean {
  return Boolean(
    member.isEnterpriseManaged || member.joinedFrom?.dsyncUserId || member.joinedFrom?.ssoUserId,
  );
}
