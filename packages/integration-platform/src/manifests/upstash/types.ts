/**
 * API types for Upstash (https://api.upstash.com/v2)
 *
 * Only the fields these checks read are modelled. `rest_token`,
 * `read_only_rest_token` and `password` are deliberately NOT modelled here:
 * the list/get database endpoints return live Redis credentials inline, and
 * nothing in this manifest may let those reach `ctx.pass`/`ctx.fail`
 * evidence, which is stored and shown to auditors. Add a field only after
 * confirming it is not a secret.
 */

/**
 * Feature flags Upstash reports per database. `ipWhitelisting` is the
 * signal the access-control check reads: when false, the database accepts
 * connections from any IP address (still gated by its token/password, but
 * with no network-level restriction).
 */
export interface UpstashSecurityAddons {
  ipWhitelisting?: boolean;
  vpcPeering?: boolean;
  privateLink?: boolean;
  tlsMutualAuth?: boolean;
  encryptionAtRest?: boolean;
}

export interface UpstashDatabase {
  database_id: string;
  database_name?: string;
  region?: string;
  primary_region?: string;
  read_regions?: string[];
  type?: string;
  port?: number;
  creation_time?: number;
  /** e.g. "active". Anything else (or absent) means the database cannot serve connections. */
  state?: string;
  endpoint?: string;
  /** Whether TLS is required for connections to this database. */
  tls?: boolean;
  multizone?: boolean;
  eviction?: boolean;
  auto_upgrade?: boolean;
  consistent?: boolean;
  db_type?: string;
  securityAddons?: UpstashSecurityAddons;
}
