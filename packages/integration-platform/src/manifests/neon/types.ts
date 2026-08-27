/**
 * API Types for Neon (https://console.neon.tech/api/v2)
 *
 * Only the fields these checks read are modelled. Everything is optional
 * except identifiers: Neon adds fields over time and gates several behind a
 * plan, so a check must be able to tell "false" from "not returned at all".
 */

// ==================== Organizations & members ====================

export interface NeonOrganization {
  id: string;
  name?: string;
  handle?: string;
  plan?: string;
  created_at?: string;
  updated_at?: string;
  managed_by?: string;
}

export interface NeonOrganizationsResponse {
  organizations?: NeonOrganization[];
}

export type NeonMemberRole = 'admin' | 'member' | 'editor' | 'viewer' | 'collaborator';

export interface NeonOrganizationMember {
  member?: {
    id?: string;
    user_id?: string;
    org_id?: string;
    role?: NeonMemberRole;
    joined_at?: string;
  };
  user?: {
    email?: string;
    /** Added by Neon alongside 2FA. Absent on older API versions — never assume `false`. */
    has_mfa?: boolean;
    deactivated_at?: string;
  };
}

export interface NeonOrganizationMembersResponse {
  members?: NeonOrganizationMember[];
  pagination?: { next?: string };
}

// ==================== Projects ====================

export interface NeonAllowedIps {
  ips?: string[];
  protected_branches_only?: boolean;
}

export interface NeonProjectSettings {
  allowed_ips?: NeonAllowedIps;
  block_public_connections?: boolean;
  block_vpc_connections?: boolean;
  enable_logical_replication?: boolean;
  hipaa?: boolean;
  /** Audit logging verbosity. Absent means audit logging was never turned on. */
  audit_log_level?: string;
}

export interface NeonProject {
  id: string;
  name?: string;
  org_id?: string;
  owner_id?: string;
  region_id?: string;
  pg_version?: number;
  platform_id?: string;
  proxy_host?: string;
  store_passwords?: boolean;
  /** Point-in-time restore window, in seconds. This is Neon's retained change history. */
  history_retention_seconds?: number;
  synthetic_storage_size?: number;
  created_at?: string;
  updated_at?: string;
  settings?: NeonProjectSettings;
}

export interface NeonProjectsResponse {
  projects?: NeonProject[];
  pagination?: { cursor?: string };
  /** Projects Neon knows exist but could not serialize — a coverage gap, not an empty result. */
  unavailable_project_ids?: string[];
}

export interface NeonProjectResponse {
  project?: NeonProject;
}

// ==================== Branches, endpoints, backups ====================

export interface NeonBranch {
  id: string;
  project_id?: string;
  name?: string;
  parent_id?: string;
  /** Current field for "this is the project's default branch". */
  default?: boolean;
  /** Deprecated predecessor of `default`; still returned by older API versions. */
  primary?: boolean;
  protected?: boolean;
  current_state?: string;
  created_at?: string;
  updated_at?: string;
}

export interface NeonBranchesResponse {
  branches?: NeonBranch[];
}

export type NeonEndpointType = 'read_write' | 'read_only';

export interface NeonEndpoint {
  id: string;
  branch_id?: string;
  project_id?: string;
  /** TLS-terminating Neon proxy hostname clients connect to. */
  host?: string;
  proxy_host?: string;
  type?: NeonEndpointType;
  disabled?: boolean;
  passwordless_access?: boolean;
  pooler_enabled?: boolean;
  current_state?: string;
  region_id?: string;
  last_active?: string;
  suspend_timeout_seconds?: number;
}

export interface NeonEndpointsResponse {
  endpoints?: NeonEndpoint[];
}

export interface NeonBackupScheduleEntry {
  /** "daily" | "weekly" | "monthly" — typed loosely so a new frequency is reported, not dropped. */
  frequency?: string;
  hour?: number;
  day?: number;
  month?: number;
  retention_seconds?: number;
}

export interface NeonBackupScheduleResponse {
  schedule?: NeonBackupScheduleEntry[];
}
