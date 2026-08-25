/**
 * PostHog API types.
 *
 * These describe the slice of PostHog's REST API the checks read, not the whole
 * schema. Fields PostHog can legitimately omit or null are optional: a member who
 * never went through email verification has `is_email_verified: null`, and a key
 * scoped without `organization:read` sees an organization object with fewer fields.
 *
 * API docs: https://posthog.com/docs/api
 */

/** PostHog paginates with limit/offset and wraps results in this envelope. */
export interface PostHogPaginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/**
 * The `user` object nested on an organization member (PostHog's UserBasicSerializer).
 *
 * `is_email_verified` is tri-state: `true` (verified), `false` (verification sent and
 * not completed), `null` (never attempted — common for accounts created before PostHog
 * required verification, and for self-hosted instances with email disabled).
 */
export interface PostHogUser {
  id?: number;
  uuid?: string;
  distinct_id?: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  is_email_verified?: boolean | null;
  role_at_organization?: string | null;
}

/**
 * Membership levels PostHog assigns inside an organization. Numeric, not an enum,
 * on the wire — 1 member, 8 admin, 15 owner.
 */
export const POSTHOG_LEVEL_MEMBER = 1;
export const POSTHOG_LEVEL_ADMIN = 8;
export const POSTHOG_LEVEL_OWNER = 15;

/**
 * PostHog sends more than this per member (`search_match_type`, and `hedgehog_config` on
 * the nested user); only the fields the checks read are modelled. See the documented
 * payload exercised verbatim in __tests__/members-payload.test.ts.
 */
export interface PostHogOrganizationMember {
  /** Membership id (not the user id). */
  id: string;
  user: PostHogUser;
  level: number;
  joined_at?: string | null;
  updated_at?: string | null;
  /** Last time the person signed in — evidence of a dormant account. */
  last_login?: string | null;
  /** True when the account has a confirmed TOTP device or WebAuthn credential. */
  is_2fa_enabled?: boolean | null;
  /** True when the account signs in through a social/SSO provider rather than a password. */
  has_social_auth?: boolean | null;
}

/** Shape returned by GET /api/organizations/ (list). */
export interface PostHogOrganizationSummary {
  id: string;
  name: string;
  slug?: string | null;
  membership_level?: number | null;
}

/** Shape returned by GET /api/organizations/{id}/ (detail). */
export interface PostHogOrganization extends PostHogOrganizationSummary {
  /** Org-wide requirement that every member enrol in 2FA. */
  enforce_2fa?: boolean | null;
  /** Org-wide requirement that members sign in from a verified email domain. */
  enforce_verified_domains?: boolean | null;
  member_count?: number | null;
}

/** Shape returned by GET /api/organizations/{id}/invites/ — an account that does not exist yet. */
export interface PostHogInvite {
  id: string;
  target_email: string;
  first_name?: string | null;
  level?: number | null;
  is_expired?: boolean | null;
  emailing_attempt_made?: boolean | null;
  created_at?: string | null;
  created_by?: PostHogUser | null;
}

/**
 * Credentials stored for a PostHog connection.
 *
 * The manifest declares `api_key` auth on the `Authorization` header with a `Bearer `
 * prefix, so the runtime's `buildHeaders` reads `api_key` and sends it for us. `host`
 * is read by the checks themselves — PostHog Cloud EU and self-hosted instances serve
 * the same API from a different origin, and a US-host request with an EU key 401s.
 */
export interface PostHogCredentials {
  api_key?: string;
  host?: string;
}
