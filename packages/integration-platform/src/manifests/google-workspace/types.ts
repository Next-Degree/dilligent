// Google Workspace Admin SDK types

export interface GoogleWorkspaceUser {
  id: string;
  primaryEmail: string;
  name: {
    givenName: string;
    familyName: string;
    fullName: string;
  };
  isAdmin: boolean;
  isDelegatedAdmin: boolean;
  isEnrolledIn2Sv: boolean;
  isEnforcedIn2Sv: boolean;
  suspended: boolean;
  archived: boolean;
  creationTime: string;
  lastLoginTime: string;
  orgUnitPath: string;
}

export interface GoogleWorkspaceUsersResponse {
  kind: string;
  users: GoogleWorkspaceUser[];
  nextPageToken?: string;
}

export interface GoogleWorkspaceOrgUnit {
  orgUnitId: string;
  orgUnitPath: string;
  name: string;
  description?: string;
  parentOrgUnitId?: string;
  parentOrgUnitPath?: string;
}

export interface GoogleWorkspaceOrgUnitsResponse {
  kind: string;
  organizationUnits: GoogleWorkspaceOrgUnit[];
}

export interface GoogleWorkspaceDomain {
  domainName: string;
  isPrimary: boolean;
  verified: boolean;
  creationTime: string;
}

export interface GoogleWorkspaceDomainsResponse {
  kind: string;
  domains: GoogleWorkspaceDomain[];
}

// Role types
export interface GoogleWorkspaceRole {
  roleId: string;
  roleName: string;
  roleDescription?: string;
  isSystemRole: boolean;
  isSuperAdminRole: boolean;
}

export interface GoogleWorkspaceRolesResponse {
  kind: string;
  items: GoogleWorkspaceRole[];
  nextPageToken?: string;
}

export interface GoogleWorkspaceRoleAssignment {
  roleAssignmentId: string;
  roleId: string;
  assignedTo: string; // User ID
  scopeType: 'CUSTOMER' | 'ORG_UNIT';
  orgUnitId?: string;
}

export interface GoogleWorkspaceRoleAssignmentsResponse {
  kind: string;
  items: GoogleWorkspaceRoleAssignment[];
  nextPageToken?: string;
}

// Third-party OAuth grant types (Admin SDK Tokens API).
//
// Note the Tokens API carries no last-used timestamp — it reports that access was
// *authorized*, never that it was recently exercised. UI copy must not imply recency.
export interface GoogleWorkspaceToken {
  /** OAuth client id — stable across display-name changes, so it is the app identity. */
  clientId: string;
  /** Absent for some clients; an app with no display name is never sent for inference. */
  displayText?: string;
  /** True for Google's own first-party clients, which are auto-ignored as queue noise. */
  nativeApp?: boolean;
  anonymous?: boolean;
  scopes?: string[];
  /** The user this grant belongs to, as returned by the API. */
  userKey?: string;
}

export interface GoogleWorkspaceTokensResponse {
  kind: string;
  items?: GoogleWorkspaceToken[];
}
