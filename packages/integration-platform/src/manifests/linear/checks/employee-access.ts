import { TASK_TEMPLATES } from '../../../task-mappings';
import type { CheckContext, IntegrationCheck } from '../../../types';
import type { LinearEmployeeAccessResponse, LinearOrganization, LinearUser } from '../types';

/** Linear's page size ceiling for a users() connection. */
const PAGE_SIZE = 250;

/**
 * Runaway guard — 20 pages is 5,000 members, far beyond any real workspace. Hitting
 * it means something is wrong (a cursor that never advances), so the check reports
 * truncation rather than presenting a partial roster as the whole workspace.
 */
const MAX_PAGES = 20;

const EMPLOYEE_ACCESS_QUERY = `query CompAIEmployeeAccess($after: String) {
  organization { id name urlKey }
  users(first: ${PAGE_SIZE}, after: $after) {
    nodes { id name displayName email active admin guest createdAt }
    pageInfo { hasNextPage endCursor }
  }
}`;

function describeRole(user: LinearUser): string {
  if (user.admin) return 'Admin';
  if (user.guest) return 'Guest';
  return 'Member';
}

/**
 * Turns a raw transport/GraphQL failure into something a customer can act on.
 * ctx.graphql throws `GraphQL: <message>` for errors returned with HTTP 200, which is
 * how Linear reports an invalid or revoked key.
 */
function friendlyError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (/authentication|not authenticated|unauthorized|401/i.test(message)) {
    return new Error(
      'Linear rejected the API key. Create a new personal API key under ' +
        'Settings > Account > Security & Access and reconnect the integration.',
    );
  }

  if (/cannot query field|unknown argument|did you mean/i.test(message)) {
    return new Error(
      `Linear's API schema no longer matches this check's query (${message}). ` +
        'The check needs updating.',
    );
  }

  return error instanceof Error ? error : new Error(message);
}

/**
 * Employee Access Review Check
 *
 * Fetches every workspace member from Linear for access review.
 * Maps to: Access Review Log task.
 */
export const employeeAccessCheck: IntegrationCheck = {
  id: 'linear_employee_access',
  name: 'Employee Access',
  description: 'Verifies Linear is connected and lists workspace members',
  taskMapping: TASK_TEMPLATES.employeeAccess,
  defaultSeverity: 'medium',

  run: async (ctx: CheckContext) => {
    ctx.log('Starting Linear Employee Access check');

    const members: LinearUser[] = [];
    let organization: LinearOrganization | null = null;
    let after: string | null = null;
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      let data: LinearEmployeeAccessResponse;
      try {
        // ctx.graphql throws on an errors[] array returned with HTTP 200 — Linear's
        // usual failure mode — so a bad key can never look like an empty workspace.
        data = await ctx.graphql<LinearEmployeeAccessResponse>(EMPLOYEE_ACCESS_QUERY, { after });
      } catch (error) {
        throw friendlyError(error);
      }

      organization = organization ?? data.organization ?? null;
      members.push(...(data.users?.nodes ?? []));

      const pageInfo = data.users?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      after = pageInfo.endCursor;

      if (page === MAX_PAGES - 1) truncated = true;
    }

    if (truncated) {
      ctx.warn(
        `Linear member list truncated at ${members.length} records after ${MAX_PAGES} pages; ` +
          'some members were not reviewed.',
      );
    }

    const checkedAt = new Date().toISOString();
    const workspace = organization?.name ?? null;
    const activeMembers = members.filter((user) => user.active);

    ctx.log(
      `Fetched ${members.length} Linear members (${activeMembers.length} active)` +
        (workspace ? ` in ${workspace}` : ''),
    );

    // No active members is still a completed review — emit one org-level row so the
    // run never stores zero results, which would read as "no evidence collected".
    if (activeMembers.length === 0) {
      ctx.pass({
        title: 'Employee Access List',
        resourceType: 'organization',
        resourceId: organization?.urlKey ?? 'linear',
        description: `No active members found (${members.length} member records inspected)`,
        evidence: {
          totalUsers: 0,
          inspectedUsers: members.length,
          truncated,
          checkedAt,
        },
      });
      ctx.log('Linear Employee Access check complete: 0 active members');
      return;
    }

    // One row per person (resourceType 'user', resourceId = lowercased email) so
    // person-scoped features can join results to org members by email. Access is an
    // inventory, not a violation — every person row emits as pass; error paths keep
    // their org-level rows. Same contract as the Google Workspace check.
    let emitted = 0;
    for (const user of activeMembers) {
      const email = String(user.email ?? '')
        .toLowerCase()
        .trim();

      if (!email) {
        ctx.warn(`Skipping Linear member ${user.id}: no email on record`);
        continue;
      }

      const role = describeRole(user);

      ctx.pass({
        title: 'Employee Access',
        resourceType: 'user',
        resourceId: email,
        description: `${user.name ?? user.displayName ?? email} has access to Linear as ${role}`,
        evidence: {
          email,
          name: user.name ?? user.displayName ?? null,
          role,
          roles: [role],
          isAdmin: Boolean(user.admin),
          isGuest: Boolean(user.guest),
          externalId: user.id,
          workspace,
          createdAt: user.createdAt ?? null,
          truncated,
          checkedAt,
        },
      });
      emitted++;
    }

    const admins = activeMembers.filter((user) => user.admin).length;
    const guests = activeMembers.filter((user) => user.guest).length;

    ctx.log(
      `Linear Employee Access check complete: ${emitted} members ` +
        `(${admins} admins, ${guests} guests)`,
    );
  },
};
