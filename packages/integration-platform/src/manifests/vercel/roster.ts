import type { CheckContext, OrganizationMemberSummary } from '../../types';

export interface OrganizationRoster {
  members: OrganizationMemberSummary[];
  /** Every known email (primary and linked) mapped to its member. */
  byEmail: Map<string, OrganizationMemberSummary>;
}

/**
 * Load the employee roster and index it by every email each person is known
 * by. Matching on the primary address alone would report an account held under
 * someone's linked provider address (typically their personal GitHub email) as
 * belonging to nobody.
 *
 * Throws when no roster is available so callers report the comparison as
 * unverified — an empty roster would read as "nobody works here", turning a
 * lookup failure into a finding against every account.
 */
export async function loadOrganizationRoster(ctx: CheckContext): Promise<OrganizationRoster> {
  if (!ctx.listOrganizationMembers) {
    throw new Error('No employee roster available in this runtime');
  }

  const members = await ctx.listOrganizationMembers();
  const byEmail = new Map<string, OrganizationMemberSummary>();

  for (const member of members) {
    for (const email of member.emails) {
      // An active record wins a collision: the same address appearing on both a
      // current and an archived member must resolve to the current one.
      const existing = byEmail.get(email);
      if (!existing || (!existing.isActive && member.isActive)) {
        byEmail.set(email, member);
      }
    }
  }

  return { members, byEmail };
}
