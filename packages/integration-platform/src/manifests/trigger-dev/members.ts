/**
 * Member helpers shared by the Trigger.dev access checks.
 */

import { normalizeEmail } from '../people-directory';
import type { TriggerMember, TriggerOrganization } from './types';

export const isAdmin = (member: TriggerMember): boolean =>
  String(member.role).toUpperCase() === 'ADMIN';

export const memberLabel = (member: TriggerMember): string =>
  member.user.name ? `${member.user.name} (${member.user.email})` : member.user.email;

interface MemberRef {
  member: TriggerMember;
  organization: TriggerOrganization;
}

/**
 * Stable per-member resource id: the same person in two orgs is two grants of access.
 * Keyed on the organization id, not its slug — admins can rename the slug, which would
 * orphan every open finding and split each person's history.
 */
export const memberResourceId = ({ member, organization }: MemberRef): string =>
  `${organization.id}:${normalizeEmail(member.user.email)}`;

export const inviteResourceId = ({
  organization,
  email,
}: {
  organization: TriggerOrganization;
  email: string;
}): string => `${organization.id}:invite:${normalizeEmail(email)}`;

export function memberEvidence({ member, organization }: MemberRef): Record<string, unknown> {
  return {
    organizationId: organization.id,
    organization: organization.slug,
    memberId: member.id,
    email: normalizeEmail(member.user.email),
    name: member.user.name,
    role: member.role,
  };
}
