/**
 * Vercel API Response Types
 */

/**
 * A deployment protection method.
 *
 * Vercel returns this two ways: absent/`null` when the method was never
 * configured, and an object carrying `enabled` when it was. An object is NOT
 * proof the method is on — a disabled one comes back as
 * `{ enabled: false, deploymentType: null }`, so `enabled === false` has to be
 * read as off. Treating the object's presence as "protected" would report
 * restricted access on a project anyone can reach.
 *
 * `deploymentType` is typed loosely because Vercel adds values over time;
 * every value it documents (`all`, `preview`,
 * `prod_deployment_urls_and_all_previews`) covers preview deployments.
 */
export interface VercelProtectionSetting {
  enabled?: boolean;
  deploymentType?: string | null;
}

export interface VercelTrustedIps extends VercelProtectionSetting {
  addresses?: Array<{ value?: string; note?: string }>;
  protectionMode?: string | null;
}

/**
 * The git repository a project deploys from. `productionBranch` is the branch
 * whose pushes become production deployments — the single most legible piece
 * of separation evidence, so it is reported when present and recorded as
 * unknown when not, never used as a pass/fail gate.
 */
export interface VercelProjectLink {
  type?: string;
  repo?: string;
  org?: string;
  productionBranch?: string | null;
}

export interface VercelProject {
  id: string;
  name: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
  framework?: string;
  devCommand?: string;
  buildCommand?: string;
  outputDirectory?: string;
  rootDirectory?: string;
  nodeVersion?: string;
  serverlessFunctionRegion?: string;
  /**
   * Deployment protection. `null` means explicitly off; `undefined` means the
   * response did not carry the field, which is NOT the same answer and is why
   * callers re-read the project rather than assume it is off.
   */
  ssoProtection?: VercelProtectionSetting | null;
  passwordProtection?: VercelProtectionSetting | null;
  trustedIps?: VercelTrustedIps | null;
  link?: VercelProjectLink | null;
}

/**
 * A custom environment on a project (anything beyond the built-in Production,
 * Preview and Development). `type` says which of the three it behaves as, so a
 * custom environment is only treated as production when it says it is.
 */
export interface VercelCustomEnvironment {
  id?: string;
  slug?: string;
  /** 'development' | 'preview' | 'production' in practice. */
  type?: string;
  description?: string;
  /** Which branches deploy here, e.g. startsWith `release/`. */
  branchMatcher?: { type?: string; pattern?: string };
  createdAt?: number;
  updatedAt?: number;
}

export interface VercelCustomEnvironmentsResponse {
  environments?: VercelCustomEnvironment[];
  accountLimit?: { total?: number };
}

/**
 * A project environment variable. `target` carries the built-in environments
 * it is assigned to; `customEnvironmentIds` carries the custom ones. `type`
 * distinguishes a credential (`encrypted`, `secret`, `sensitive`) from plain
 * configuration and from Vercel's own `system` values.
 */
export interface VercelProjectEnvVar {
  id?: string;
  key?: string;
  type?: string;
  target?: string[];
  customEnvironmentIds?: string[];
  gitBranch?: string | null;
  system?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface VercelProjectEnvsResponse {
  envs?: VercelProjectEnvVar[];
}

export interface VercelProjectsResponse {
  projects: VercelProject[];
  pagination?: {
    count: number;
    next: number | null;
    prev: number | null;
  };
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
  type: 'LAMBDAS';
  created: number;
  createdAt: number;
  buildingAt?: number;
  ready?: number;
  creator: {
    uid: string;
    email?: string;
    username?: string;
  };
  meta?: Record<string, string>;
  target?: 'production' | 'staging' | null;
  aliasError?: {
    code: string;
    message: string;
  };
  aliasAssigned?: number;
}

export interface VercelDeploymentsResponse {
  deployments: VercelDeployment[];
  pagination?: {
    count: number;
    next: number | null;
    prev: number | null;
  };
}

export interface VercelWebhook {
  id: string;
  url: string;
  events: string[];
  projectIds?: string[];
  createdAt: number;
}

export interface VercelWebhooksResponse {
  webhooks?: VercelWebhook[];
}

export interface VercelIntegrationConfiguration {
  id: string;
  slug?: string;
  integrationId: string;
  ownerId: string;
  teamId?: string;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  scopes?: string[];
  disabledAt?: number;
}

export interface VercelNotificationChannel {
  id: string;
  type: 'email' | 'slack' | 'webhook';
  name: string;
  createdAt: number;
}

export interface VercelAlert {
  id: string;
  name: string;
  enabled: boolean;
  type: string;
  projectId?: string;
  notificationChannels: string[];
  createdAt: number;
  updatedAt: number;
}

export interface VercelUser {
  id: string;
  email: string;
  name?: string;
  username: string;
  avatar?: string;
}

export interface VercelTeam {
  id: string;
  slug: string;
  name?: string;
  createdAt: number;
  avatar?: string;
}

export interface VercelUserResponse {
  user: VercelUser;
}

/**
 * Roles Vercel documents for team members. Kept as a union for the roles we
 * reason about, but member.role stays `string` — Vercel adds roles over time
 * and an unknown role must not break parsing.
 */
export type VercelTeamRole =
  | 'BILLING'
  | 'CONTRIBUTOR'
  | 'DEVELOPER'
  | 'MEMBER'
  | 'OWNER'
  | 'SECURITY'
  | 'VIEWER'
  | 'VIEWER_FOR_PLUS';

/** Where a member came from — carries the IdP linkage used for offboarding. */
export interface VercelTeamMemberJoinedFrom {
  origin?: string;
  ssoUserId?: string;
  ssoConnectedAt?: number;
  idpUserId?: string;
  dsyncUserId?: string;
  dsyncConnectedAt?: number;
  gitUserId?: string;
  gitUserLogin?: string;
}

export interface VercelTeamMember {
  uid: string;
  email?: string;
  username?: string;
  name?: string;
  /** One of VercelTeamRole in practice; typed loosely for forward compatibility. */
  role: string;
  confirmed: boolean;
  createdAt: number;
  accessRequestedAt?: number;
  joinedFrom?: VercelTeamMemberJoinedFrom;
  isEnterpriseManaged?: boolean;
  projects?: Array<{ id?: string; name?: string; role?: string }>;
}

export interface VercelEmailInviteCode {
  id: string;
  email?: string;
  role?: string;
  createdAt?: number;
  expired?: boolean;
  isDSyncUser?: boolean;
}

export interface VercelTeamMembersResponse {
  members?: VercelTeamMember[];
  emailInviteCodes?: VercelEmailInviteCode[];
  pagination?: {
    count?: number;
    hasNext?: boolean;
    next?: number | null;
    prev?: number | null;
  };
}

/** State of a SAML SSO connection or a Directory Sync (SCIM) connection. */
export interface VercelSamlConnectionState {
  type?: string;
  state?: string;
  connectedAt?: number;
  syncState?: string;
  status?: string;
}

export interface VercelTeamDetails {
  id: string;
  slug?: string;
  name?: string;
  /** Verified domain configured on the team, when the team has one. */
  emailDomain?: string | null;
  saml?: {
    connection?: VercelSamlConnectionState;
    directory?: VercelSamlConnectionState;
    enforced?: boolean;
  };
}

export interface VercelFirewallManagedRule {
  active?: boolean;
  action?: string;
  updatedAt?: string;
}

export interface VercelFirewallConfig {
  id?: string;
  version?: number;
  updatedAt?: string;
  firewallEnabled?: boolean;
  botIdEnabled?: boolean;
  crs?: Record<string, { active?: boolean; action?: string }>;
  rules?: Array<{ id?: string; name?: string; active?: boolean }>;
  ips?: Array<{ id?: string; hostname?: string; ip?: string; action?: string }>;
  managedRules?: Record<string, VercelFirewallManagedRule>;
}

/**
 * `/v1/security/firewall/config/active` returns the config directly on some
 * API versions and wrapped in `{ active }` on others — both shapes are read.
 */
export interface VercelFirewallConfigResponse {
  active?: VercelFirewallConfig;
}

/**
 * Storage store types Vercel returns from `/v1/storage/stores`. `integration`
 * is a Marketplace store (Neon, Upstash, Supabase, …) provisioned through a
 * third party rather than run by Vercel itself. Typed loosely because Vercel
 * adds store types over time and an unknown one must not break parsing.
 */
export type VercelStoreType =
  'blob' | 'edge-config' | 'global-config' | 'integration' | 'postgres' | 'redis';

/** Projects a store is connected to, as reported alongside the store. */
export interface VercelStoreProjectMetadata {
  id?: string;
  name?: string;
  projectId?: string;
  envVarPrefix?: string;
  environments?: string[];
}

export interface VercelStore {
  id?: string;
  name?: string;
  /** One of VercelStoreType in practice; typed loosely for forward compatibility. */
  type?: string;
  /** `available`, `suspended`, `error`, `initializing`, `uninstalled`, … */
  status?: string | null;
  region?: string;
  createdAt?: number;
  updatedAt?: number;
  ownerId?: string;
  /** Blob stores only: whether objects are served publicly or require a token. */
  access?: string;
  projectsMetadata?: VercelStoreProjectMetadata[];
  totalConnectedProjects?: number;
  /** Marketplace stores: which third-party product backs this store. */
  productSlug?: string;
  product?: { slug?: string; name?: string };
  integrationId?: string;
  integrationProductId?: string;
  integrationConfigurationId?: string;
}

export interface VercelStoresResponse {
  stores?: VercelStore[];
  pagination?: {
    count?: number;
    hasNext?: boolean;
    next?: number | string | null;
    prev?: number | string | null;
  };
}
