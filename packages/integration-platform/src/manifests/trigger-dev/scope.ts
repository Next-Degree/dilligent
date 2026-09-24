/**
 * What a Trigger.dev check run covers: the organizations (and their projects) the token
 * can see, narrowed to the connection's selection.
 *
 * Every read failure here is reported as a finding and stops the check. Passing on an
 * empty scope would present "we could not look" as "nothing is wrong".
 */

import type { CheckContext } from '../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../http-read-failure';
import {
  getMembers,
  listOrganizations,
  listProjects,
  requirePersonalAccessToken,
  TRIGGER_TOKENS_URL,
} from './client';
import type { TriggerMembersResponse, TriggerOrganization, TriggerProject } from './types';
import { parseTargetOrganizations } from './variables';

const TOKEN_REMEDIATION = `Confirm the Personal Access Token is still valid and belongs to an organization Admin (create one at ${TRIGGER_TOKENS_URL}), then reconnect.`;

export interface TriggerOrganizationScope {
  organizations: TriggerOrganization[];
  checkedAt: string;
}

export interface TriggerProjectScope extends TriggerOrganizationScope {
  projects: TriggerProject[];
}

/**
 * Narrow to the selection. A selection that matches nothing — the connection was set up
 * against organizations the token can no longer see — keeps everything: reviewing too
 * much is recoverable, silently reviewing nothing is not.
 */
export function filterOrganizations(
  organizations: TriggerOrganization[],
  targets: Set<string>,
): TriggerOrganization[] {
  if (targets.size === 0) return organizations;
  const selected = organizations.filter(
    (org) => targets.has(org.id.toLowerCase()) || targets.has(org.slug.toLowerCase()),
  );
  return selected.length > 0 ? selected : organizations;
}

export async function resolveOrganizations(
  ctx: CheckContext,
): Promise<TriggerOrganizationScope | null> {
  if (!requirePersonalAccessToken(ctx)) return null;
  const checkedAt = new Date().toISOString();

  let organizations: TriggerOrganization[];
  try {
    organizations = await listOrganizations(ctx);
  } catch (error) {
    const failure = toHttpReadFailure(error);
    ctx.fail({
      title: 'Failed to read Trigger.dev organizations',
      description: `Could not list the organizations this token belongs to: ${failure.error}`,
      resourceType: 'trigger_dev_connection',
      resourceId: 'organizations',
      severity: 'medium',
      remediation: remediationForReadFailure(failure, TOKEN_REMEDIATION),
      evidence: { error: failure.error, denied: failure.denied, checkedAt },
    });
    return null;
  }

  if (organizations.length === 0) {
    ctx.fail({
      title: 'Trigger.dev token belongs to no organization',
      description:
        'The Personal Access Token authenticated, but its account is not a member of any Trigger.dev organization, so there is nothing to review.',
      resourceType: 'trigger_dev_connection',
      resourceId: 'organizations',
      severity: 'medium',
      remediation: TOKEN_REMEDIATION,
      evidence: { checkedAt },
    });
    return null;
  }

  const selected = filterOrganizations(organizations, parseTargetOrganizations(ctx.variables));
  ctx.log(`Reviewing ${selected.length} of ${organizations.length} Trigger.dev organization(s)`);
  return { organizations: selected, checkedAt };
}

export async function resolveProjects(ctx: CheckContext): Promise<TriggerProjectScope | null> {
  const scope = await resolveOrganizations(ctx);
  if (!scope) return null;

  let projects: TriggerProject[];
  try {
    projects = await listProjects(ctx);
  } catch (error) {
    const failure = toHttpReadFailure(error);
    ctx.fail({
      title: 'Failed to read Trigger.dev projects',
      description: `Could not list projects: ${failure.error}`,
      resourceType: 'trigger_dev_connection',
      resourceId: 'projects',
      severity: 'medium',
      remediation: remediationForReadFailure(failure, TOKEN_REMEDIATION),
      evidence: { error: failure.error, denied: failure.denied, checkedAt: scope.checkedAt },
    });
    return null;
  }

  const orgIds = new Set(scope.organizations.map((org) => org.id));
  const inScope = projects.filter((project) => orgIds.has(project.organization?.id));

  if (inScope.length === 0) {
    ctx.fail({
      title: 'No Trigger.dev projects found',
      description: `None of the ${scope.organizations.length} organization(s) in scope has a project this token can see.`,
      resourceType: 'trigger_dev_connection',
      resourceId: 'projects',
      severity: 'low',
      remediation:
        'Create the project in Trigger.dev, or reconnect with a token from an account that is a member of the organization that owns it.',
      evidence: {
        organizations: scope.organizations.map((org) => org.slug),
        checkedAt: scope.checkedAt,
      },
    });
    return null;
  }

  return { ...scope, projects: inScope };
}

/** Members and pending invites for one organization, or null after reporting the failure. */
export async function loadRoster(
  ctx: CheckContext,
  options: { organization: TriggerOrganization; checkedAt: string },
): Promise<TriggerMembersResponse | null> {
  const { organization, checkedAt } = options;
  try {
    return await getMembers(ctx, organization.id);
  } catch (error) {
    const failure = toHttpReadFailure(error);
    ctx.fail({
      title: `Failed to read members of ${organization.title}`,
      description: `Could not list Trigger.dev organization members: ${failure.error}`,
      resourceType: 'trigger_dev_organization',
      resourceId: organization.id,
      severity: 'medium',
      remediation: remediationForReadFailure(
        failure,
        `Reading members requires the Admin role. ${TOKEN_REMEDIATION}`,
      ),
      evidence: {
        organization: organization.slug,
        error: failure.error,
        denied: failure.denied,
        checkedAt,
      },
    });
    return null;
  }
}
