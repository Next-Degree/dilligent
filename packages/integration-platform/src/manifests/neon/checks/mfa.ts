import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../../http-read-failure';
import { API_VERIFIED } from '../attestation';
import {
  fetchAllNeonProjects,
  listNeonOrganizationMembers,
  listNeonOrganizations,
} from '../client';
import type { NeonOrganization, NeonOrganizationMember } from '../types';

const REMEDIATION =
  'Ask this member to enable two-factor authentication in Neon Console > Account settings > Security, and enforce it for the organization under Organization settings.';

/**
 * Organization ids this key can reach. An organization-scoped key cannot list
 * `/users/me/organizations`, but the projects it returns carry `org_id` — so
 * the project listing doubles as organization discovery and the check works
 * under either key shape.
 */
async function resolveOrganizations(ctx: CheckContext): Promise<NeonOrganization[]> {
  const organizations = await listNeonOrganizations(ctx);
  const byId = new Map(organizations.map((org) => [org.id, org]));

  const { projects } = await fetchAllNeonProjects(ctx, organizations);
  for (const project of projects) {
    if (project.org_id && !byId.has(project.org_id)) {
      byId.set(project.org_id, { id: project.org_id });
    }
  }

  return Array.from(byId.values());
}

const memberIdentity = (entry: NeonOrganizationMember, orgId: string) => ({
  organizationId: orgId,
  memberId: entry.member?.id ?? null,
  userId: entry.member?.user_id ?? null,
  email: entry.user?.email ?? null,
  role: entry.member?.role ?? null,
  joinedAt: entry.member?.joined_at ?? null,
});

/**
 * MFA on Neon
 *
 * Reads every organization member's `has_mfa` flag. Deactivated members are
 * counted but not judged — they cannot sign in. A member whose flag Neon does
 * not return is reported as unknown rather than passed: older API versions
 * omit the field entirely, and treating "absent" as "enabled" would turn a
 * blind spot into a clean result.
 *
 * Maps to: 2FA
 */
export const mfaCheck: IntegrationCheck = {
  id: 'mfa-enabled',
  name: 'MFA on Neon',
  description: 'Verify every Neon organization member has two-factor authentication enabled',
  service: 'access',
  taskMapping: TASK_TEMPLATES.twoFactorAuth,
  defaultSeverity: 'high',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Neon MFA check');
    const checkedAt = new Date().toISOString();

    let organizations: NeonOrganization[];
    try {
      organizations = await resolveOrganizations(ctx);
    } catch (error) {
      const failure = toHttpReadFailure(error);
      ctx.fail({
        title: 'Failed to resolve Neon organizations',
        description: `Could not determine which Neon organizations this key covers: ${failure.error}`,
        resourceType: 'neon',
        resourceId: 'organizations',
        severity: 'high',
        remediation: remediationForReadFailure(
          failure,
          'Check that the Neon API key is valid, then re-run the check.',
        ),
        evidence: { error: failure.error, denied: failure.denied, checkedAt },
      });
      return;
    }

    if (organizations.length === 0) {
      ctx.fail({
        title: 'No Neon organization found',
        description:
          'This key resolves to no Neon organization, so its members cannot be enumerated. A personal Neon account has no organization member list to audit.',
        resourceType: 'neon',
        resourceId: 'organizations',
        severity: 'medium',
        remediation:
          'Connect Neon with an API key belonging to the organization that owns your projects (Neon Console > Organization settings > API keys).',
        evidence: { checkedAt },
      });
      return;
    }

    let withMfa = 0;
    let judged = 0;

    for (const organization of organizations) {
      let members: NeonOrganizationMember[];
      try {
        members = await listNeonOrganizationMembers(ctx, organization.id);
      } catch (error) {
        const failure = toHttpReadFailure(error);
        ctx.fail({
          title: `MFA status unknown for organization ${organization.name ?? organization.id}`,
          description: `Could not list organization members: ${failure.error}`,
          resourceType: 'neon_organization',
          resourceId: organization.id,
          severity: 'high',
          remediation: remediationForReadFailure(
            failure,
            'Listing members requires an API key with admin access to the organization. Re-create the key from Organization settings and re-run the check.',
          ),
          evidence: { error: failure.error, denied: failure.denied, checkedAt },
        });
        continue;
      }

      const active = members.filter((entry) => !entry.user?.deactivated_at);
      ctx.log(
        `Organization ${organization.id}: ${active.length} active member(s) of ${members.length}`,
      );

      for (const entry of active) {
        const identity = memberIdentity(entry, organization.id);
        const label = identity.email ?? identity.userId ?? identity.memberId ?? 'unknown member';
        const resourceId = identity.memberId ?? identity.userId ?? label;
        const evidence = {
          verification: API_VERIFIED,
          ...identity,
          hasMfa: entry.user?.has_mfa ?? null,
          checkedAt,
        };
        judged++;

        if (entry.user?.has_mfa === true) {
          withMfa++;
          ctx.pass({
            title: `MFA enabled: ${label}`,
            description: `${label} has two-factor authentication enabled on their Neon account.`,
            resourceType: 'neon_member',
            resourceId,
            evidence,
          });
          continue;
        }

        const unknown = entry.user?.has_mfa === undefined;
        ctx.fail({
          title: unknown ? `MFA status unknown: ${label}` : `MFA not enabled: ${label}`,
          description: unknown
            ? `Neon did not report an MFA status for ${label}, so two-factor authentication cannot be evidenced for this member.`
            : `${label} can sign in to Neon without two-factor authentication.`,
          resourceType: 'neon_member',
          resourceId,
          severity: unknown ? 'medium' : 'high',
          remediation: REMEDIATION,
          evidence,
        });
      }

      ctx.pass({
        title: `Neon organization membership: ${organization.name ?? organization.id}`,
        description: `${active.length} active member(s) reviewed for two-factor authentication.`,
        resourceType: 'neon_organization',
        resourceId: organization.id,
        evidence: {
          verification: API_VERIFIED,
          organizationId: organization.id,
          organizationName: organization.name ?? null,
          plan: organization.plan ?? null,
          memberCount: members.length,
          activeMemberCount: active.length,
          deactivatedMemberCount: members.length - active.length,
          checkedAt,
        },
      });
    }

    ctx.log(`Neon MFA check complete: ${withMfa}/${judged} active member(s) with MFA enabled`);
  },
};
