import type { CheckContext } from '../../../types';
import type {
  AttioAccessLevel,
  AttioSelfResponse,
  AttioWorkspaceMember,
  AttioWorkspaceMembersResponse,
} from '../types';

/** Workspace identity, read from /v2/self, used to label evidence. */
export interface AttioWorkspace {
  id: string | null;
  name: string | null;
  slug: string;
}

/** Fallback resourceId for org-level rows when /v2/self could not be read. */
const UNKNOWN_WORKSPACE_SLUG = 'attio';

/**
 * Turns a raw transport failure into something a customer can act on. Attio answers a
 * revoked or mis-scoped key with 401/403, which would otherwise surface as an opaque
 * HTTP error in the run log.
 */
export function friendlyError(error: unknown, context: string): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (/\b401\b|unauthor|invalid[_ -]?token|authentication/i.test(message)) {
    return new Error(
      `Attio rejected the API key while ${context}. Generate a new key under ` +
        'Workspace settings > Developers > API keys and reconnect the integration.',
    );
  }

  if (/\b403\b|forbidden|scope|permission/i.test(message)) {
    return new Error(
      `Attio denied access while ${context}. The API key needs the "user_management:read" ` +
        'scope — edit the key in Workspace settings > Developers and enable it, then rerun.',
    );
  }

  return new Error(`Attio request failed while ${context}: ${message}`);
}

/**
 * Reads the workspace behind the API key.
 *
 * Failures are downgraded to a warning rather than thrown: /v2/self only supplies
 * evidence labels, so losing it should not fail a check whose real data source —
 * the member list — is fetched separately and does throw on error.
 */
export async function fetchWorkspace(ctx: CheckContext): Promise<AttioWorkspace> {
  try {
    const self = await ctx.fetch<AttioSelfResponse>('/v2/self');
    return {
      id: self.workspace_id ?? null,
      name: self.workspace_name ?? null,
      slug: self.workspace_slug || UNKNOWN_WORKSPACE_SLUG,
    };
  } catch (error) {
    ctx.warn(
      `Could not identify the Attio workspace: ${friendlyError(error, 'reading /v2/self').message}`,
    );
    return { id: null, name: null, slug: UNKNOWN_WORKSPACE_SLUG };
  }
}

/**
 * Fetches every workspace member.
 *
 * GET /v2/workspace_members takes no pagination parameters and returns the whole
 * workspace in one response, so there is no cursor loop and no truncation to report.
 */
export async function fetchWorkspaceMembers(ctx: CheckContext): Promise<AttioWorkspaceMember[]> {
  let response: AttioWorkspaceMembersResponse;
  try {
    response = await ctx.fetch<AttioWorkspaceMembersResponse>('/v2/workspace_members');
  } catch (error) {
    throw friendlyError(error, 'listing workspace members');
  }

  return Array.isArray(response?.data) ? response.data : [];
}

/** Suspended members keep their row in Attio but hold no access. */
export function hasWorkspaceAccess(member: AttioWorkspaceMember): boolean {
  return member.access_level !== 'suspended';
}

/** Lowercased email, used as the resourceId that joins Attio members to org members. */
export function memberEmail(member: AttioWorkspaceMember): string {
  return String(member.email_address ?? '')
    .trim()
    .toLowerCase();
}

export function memberName(member: AttioWorkspaceMember): string {
  const name = [member.first_name, member.last_name]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  return name || memberEmail(member) || member.id?.workspace_member_id || 'Unknown member';
}

const ACCESS_LEVEL_LABELS: Record<AttioAccessLevel, string> = {
  admin: 'Admin',
  member: 'Member',
  suspended: 'Suspended',
};

export function describeAccessLevel(member: AttioWorkspaceMember): string {
  return ACCESS_LEVEL_LABELS[member.access_level] ?? 'Unknown';
}

/** Evidence fields every Attio check records for a member, so rows stay comparable. */
export function memberEvidence(
  member: AttioWorkspaceMember,
  workspace: AttioWorkspace,
): Record<string, unknown> {
  return {
    email: memberEmail(member) || null,
    name: memberName(member),
    accessLevel: member.access_level,
    role: describeAccessLevel(member),
    isAdmin: member.access_level === 'admin',
    isSuspended: member.access_level === 'suspended',
    externalId: member.id?.workspace_member_id ?? null,
    workspace: workspace.name,
    workspaceSlug: workspace.slug,
    joinedAt: member.created_at ?? null,
  };
}
