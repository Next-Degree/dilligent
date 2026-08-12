/**
 * Linear API types.
 *
 * Linear is GraphQL-only — a single endpoint at POST https://api.linear.app/graphql.
 * These shapes describe the slice of the schema the checks query, not the whole API.
 *
 * Fields are optional wherever Linear can legitimately omit them (a member invited
 * but not yet accepted has no name; guest accounts may have no email visible to the
 * key's permission scope). Only `id` and `active` are relied on unconditionally.
 */

export interface LinearUser {
  id: string;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
  /** False for deactivated/suspended members. */
  active: boolean;
  /** Workspace admin. */
  admin?: boolean | null;
  /** Guest accounts have access to a limited set of teams. */
  guest?: boolean | null;
  createdAt?: string | null;
}

export interface LinearOrganization {
  id: string;
  name: string;
  /** Workspace slug, e.g. "acme" in linear.app/acme. */
  urlKey: string;
}

export interface LinearPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

/** Response shape of the employee-access query. */
export interface LinearEmployeeAccessResponse {
  organization: LinearOrganization | null;
  users: {
    nodes: LinearUser[];
    pageInfo: LinearPageInfo;
  };
}

/**
 * Credentials stored for a Linear connection.
 *
 * The manifest declares `api_key` auth on the `Authorization` header, so the runtime's
 * `buildHeaders` reads this value and sends it raw — Linear personal API keys carry no
 * `Bearer ` prefix, unlike its OAuth tokens.
 */
export interface LinearCredentials {
  api_key?: string;
}
