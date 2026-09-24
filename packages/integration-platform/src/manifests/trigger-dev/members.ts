/**
 * Member helpers shared by the Trigger.dev access checks.
 */

import { normalizeEmail } from './directory';
import type { TriggerMember, TriggerOrganization } from './types';

export const isAdmin = (member: TriggerMember): boolean =>
  String(member.role).toUpperCase() === 'ADMIN';

export const memberLabel = (member: TriggerMember): string =>
  member.user.name ? `${member.user.name} (${member.user.email})` : member.user.email;

/** Stable per-member resource id: the same person in two orgs is two grants of access. */
export const memberResourceId = (member: TriggerMember, organization: TriggerOrganization) =>
  `${organization.slug}:${normalizeEmail(member.user.email)}`;

export function memberEvidence(
  member: TriggerMember,
  organization: TriggerOrganization,
): Record<string, unknown> {
  return {
    organizationId: organization.id,
    organization: organization.slug,
    memberId: member.id,
    email: normalizeEmail(member.user.email),
    name: member.user.name,
    role: member.role,
  };
}
