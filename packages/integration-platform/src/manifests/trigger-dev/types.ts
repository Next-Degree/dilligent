/**
 * Trigger.dev API types.
 *
 * These describe the slice of Trigger.dev's REST API the checks read, not the whole
 * schema. They mirror the zod schemas in `@trigger.dev/core` (`schemas/api.ts`) and the
 * webapp's `api.v1.orgs.$orgParam.members` route, which is where the members payload is
 * defined — it has no published schema.
 *
 * Every endpoint here accepts a Personal Access Token (`tr_pat_...`). Environment secret
 * keys (`tr_prod_...`) are scoped to one environment and cannot read organizations,
 * members or other projects, so the checks refuse them up front.
 */

/** GET /api/v1/orgs — organizations the token's user belongs to. */
export interface TriggerOrganization {
  id: string;
  title: string;
  slug: string;
  createdAt?: string;
}

/** GET /api/v1/projects — every project across the user's organizations. */
export interface TriggerProject {
  id: string;
  /** The project ref (`proj_...`), which every per-project endpoint is addressed by. */
  externalRef: string;
  name: string;
  slug: string;
  createdAt?: string;
  organization: TriggerOrganization;
}

export type TriggerEnvironmentType = 'DEVELOPMENT' | 'STAGING' | 'PREVIEW' | 'PRODUCTION';

/**
 * GET /api/v1/projects/{ref}/environments.
 *
 * Only the caller's own DEVELOPMENT environment is returned (dev environments are
 * per-member), and preview branches are folded into their branchable parent.
 */
export interface TriggerEnvironment {
  id: string;
  /** Env-var and runs-filter identifier: `dev`, `stg`, `prod`, `preview`. */
  slug: string;
  type: TriggerEnvironmentType;
  isBranchableEnvironment: boolean;
  branchName: string | null;
  /** A paused environment accepts triggers but executes nothing. */
  paused: boolean;
}

/** Trigger.dev has exactly two organization roles. */
export type TriggerMemberRole = 'ADMIN' | 'MEMBER';

export interface TriggerMember {
  id: string;
  role: TriggerMemberRole | string;
  user: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl?: string | null;
  };
}

export interface TriggerInvite {
  id: string;
  email: string;
  /** Set on creation and on every resend, so it is the age of the live invitation. */
  updatedAt: string;
  inviter?: { id: string; name: string | null; email: string } | null;
}

/** GET /api/v1/orgs/{org}/members — members and pending invites in one response. */
export interface TriggerMembersResponse {
  members: TriggerMember[];
  invites: TriggerInvite[];
}

/** GET /api/v1/projects/{ref}/{env}/workers/current — the live deployed version. */
export interface TriggerCurrentWorkerResponse {
  worker: {
    id: string;
    version: string;
    engine?: string | null;
    sdkVersion?: string | null;
    cliVersion?: string | null;
    tasks: Array<{ id: string; slug: string; filePath?: string; triggerSource?: string }>;
  };
  urls?: { runs?: string };
}

/** The run fields the availability check reads from GET /api/v1/projects/{ref}/runs. */
export interface TriggerRun {
  id: string;
  status: string;
  taskIdentifier: string;
  createdAt: string;
  finishedAt?: string;
}

export interface TriggerRunsPage {
  data: TriggerRun[];
  pagination?: { next?: string; previous?: string };
}
