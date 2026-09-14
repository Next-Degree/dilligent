/**
 * Attio API types.
 *
 * These shapes describe the slice of Attio's v2 REST API the checks read, taken from
 * the published OpenAPI document at https://api.attio.com/openapi/api.
 *
 * Every field on `workspace-member` is `required` in that schema, so nothing here is
 * optional beyond what Attio itself nullifies (`avatar_url`). The checks still guard
 * against missing values at runtime — a workspace member with no email cannot be
 * joined to an org member, so it is reported rather than trusted.
 */

/**
 * Attio's privilege levels. `suspended` is not a separate flag: a suspended member
 * keeps their row (Attio never deletes members, so past actions stay attributable)
 * and this field is the only signal that their access is revoked.
 */
export type AttioAccessLevel = 'admin' | 'member' | 'suspended';

export interface AttioWorkspaceMemberId {
  workspace_id: string;
  workspace_member_id: string;
}

export interface AttioWorkspaceMember {
  id: AttioWorkspaceMemberId;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  email_address: string;
  /** ISO-8601 timestamp of when the member joined the workspace. */
  created_at: string;
  access_level: AttioAccessLevel;
}

/**
 * GET /v2/workspace_members. The endpoint takes no pagination parameters and returns
 * every member of the workspace in one response, so the checks read `data` directly
 * rather than looping.
 */
export interface AttioWorkspaceMembersResponse {
  data: AttioWorkspaceMember[];
}

/**
 * GET /v2/self — Attio's token introspection endpoint. The checks call it to name the
 * workspace in evidence and to surface a revoked key as an auth error up front, rather
 * than as an empty member list.
 */
export interface AttioSelfResponse {
  active: boolean;
  /** Space-separated scope list, e.g. "user_management:read record_permission:read". */
  scope: string;
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  workspace_logo_url: string | null;
  authorized_by_workspace_member_id?: string;
}

/**
 * Credentials stored for an Attio connection.
 *
 * The manifest declares `api_key` auth on the `Authorization` header with a `Bearer `
 * prefix, so the runtime's `buildHeaders` reads this value and sends it as
 * `Authorization: Bearer <key>`.
 */
export interface AttioCredentials {
  api_key?: string;
}
