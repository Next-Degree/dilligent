/**
 * Railway GraphQL API types.
 *
 * Only the fields the checks select are typed, and every field the schema
 * marks nullable stays optional here: a check must never read a missing field
 * as a confirmed value. Shapes were taken from the public schema at
 * https://backboard.railway.com/graphql/v2 (introspection).
 */

export interface RailwayWorkspaceRef {
  id: string;
  name: string;
}

export interface RailwayWorkspaceMember {
  id: string;
  email: string;
  name?: string | null;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
  /** Nullable in the schema: Railway withholds it from callers who may not see it. */
  twoFactorAuthEnabled?: boolean | null;
}

export interface RailwayWorkspace extends RailwayWorkspaceRef {
  has2FAEnforcement: boolean;
  members: RailwayWorkspaceMember[];
}

export interface RailwayPageInfo {
  hasNextPage: boolean;
  endCursor?: string | null;
}

export interface RailwayConnection<T> {
  edges: Array<{ node: T }>;
  pageInfo: RailwayPageInfo;
}

export type RailwayCertificateStatus =
  | 'CERTIFICATE_STATUS_TYPE_ISSUE_FAILED'
  | 'CERTIFICATE_STATUS_TYPE_ISSUING'
  | 'CERTIFICATE_STATUS_TYPE_UNSPECIFIED'
  | 'CERTIFICATE_STATUS_TYPE_VALID'
  | 'CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP'
  | 'UNRECOGNIZED';

export interface RailwayCertificate {
  domainNames: string[];
  expiresAt?: string | null;
  issuedAt?: string | null;
  keyType: string;
}

export interface RailwayCustomDomain {
  id: string;
  domain: string;
  status: {
    certificateStatus: RailwayCertificateStatus;
    certificateErrorMessage?: string | null;
    cdnProvider?: string | null;
    verified: boolean;
    certificates?: RailwayCertificate[] | null;
  };
}

export interface RailwayServiceDomain {
  id: string;
  domain: string;
}

export type RailwayDeploymentStatus =
  | 'BUILDING'
  | 'CRASHED'
  | 'DEPLOYING'
  | 'FAILED'
  | 'INITIALIZING'
  | 'NEEDS_APPROVAL'
  | 'QUEUED'
  | 'REMOVED'
  | 'REMOVING'
  | 'SKIPPED'
  | 'SLEEPING'
  | 'SUCCESS'
  | 'WAITING';

export interface RailwayDeployment {
  id: string;
  status: RailwayDeploymentStatus;
  createdAt: string;
}

/**
 * Each check selects only its own service fields (see `INSTANCE_FIELDS` in
 * client.ts), so the deployment and domain fields are optional here: the
 * availability check reads the first group, the TLS check the second.
 */
export interface RailwayServiceInstance {
  id: string;
  serviceId: string;
  serviceName: string;
  cronSchedule?: string | null;
  latestDeployment?: RailwayDeployment | null;
  activeDeployments?: RailwayDeployment[];
  domains?: {
    customDomains: RailwayCustomDomain[];
    serviceDomains: RailwayServiceDomain[];
  };
}

export interface RailwayEnvironment {
  id: string;
  name: string;
  isEphemeral: boolean;
  serviceInstances: RailwayConnection<RailwayServiceInstance>;
}

export interface RailwayProject {
  id: string;
  name: string;
  primaryEnvironmentId?: string | null;
  environments: RailwayConnection<RailwayEnvironment>;
}
