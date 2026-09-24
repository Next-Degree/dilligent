import type { CheckResultRow } from '../../integration-platform/services/check-results.service';

/** Rows older than this cannot justify concluding that access was withdrawn. */
export const FRESHNESS_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Marker evidence shape this reconciler understands. A newer version is not trusted. */
export const SUPPORTED_SCHEMA_VERSION = 1;

const INVENTORY_RESOURCE_TYPE = 'inventory';
const OAUTH_APP_RESOURCE_TYPE = 'oauth_app';
const SCOPE_CONSENT_RESOURCE_ID = 'google-workspace:scope-consent';

export interface ObservedGrantee {
  email: string;
  userKey: string;
  scopes: string[];
}

export interface ObservedApp {
  externalAppId: string;
  displayName: string | null;
  nativeApp: boolean;
  anonymous: boolean;
  /** Union of scopes across every grantee of this app. */
  scopes: string[];
  grantees: ObservedGrantee[];
}

export type UntrustworthyReason =
  | 'no-results'
  | 'no-marker'
  | 'unsupported-schema'
  | 'incomplete'
  | 'no-users-inspected'
  | 'stale'
  | 'consent-failure';

export interface ReconciliationInput {
  rows: CheckResultRow[];
  now: Date;
}

export interface ReconciliationPlan {
  /** Apps observed in this run, regrouped across spill rows with scopes expanded. */
  apps: ObservedApp[];
  /**
   * Whether absence in this run may be read as withdrawal. When false the caller must
   * upsert what it saw and skip every revocation branch.
   */
  trustworthy: boolean;
  /** Why reconciliation was skipped, for reporting. Null when trustworthy. */
  untrustworthyReason: UntrustworthyReason | null;
  /** Collection time of the run, used to stamp withdrawals. */
  collectedAt: Date | null;
}

interface MarkerEvidence {
  schemaVersion?: number;
  complete?: boolean;
  usersInspected?: number;
}

interface AppEvidence {
  clientId?: string;
  displayName?: string | null;
  nativeApp?: boolean;
  anonymous?: boolean;
  scopeCatalog?: string[];
  grantees?: Array<{ email?: string; userKey?: string; scopeIndices?: number[] }>;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Decide whether a run's results may be read as a complete picture, and regroup them.
 *
 * This gate exists because reconciliation writes `revokedAt` on the basis of *absence*, and
 * absence only means "withdrawn" if the run that produced it actually saw everything. A run
 * that failed halfway, or that could not read most users, looks identical to a run where
 * everyone revoked access — so the check emits a completeness marker and this refuses to act
 * without it.
 *
 * Note that zero app rows is never on its own read as "everything was revoked": only a
 * marker that reports completeness *and* a non-zero user count gets there, which correctly
 * describes an organization where nobody has authorized anything.
 */
export function planReconciliation({ rows, now }: ReconciliationInput): ReconciliationPlan {
  if (rows.length === 0) {
    return { apps: [], trustworthy: false, untrustworthyReason: 'no-results', collectedAt: null };
  }

  const marker = rows.find((row) => row.resourceType === INVENTORY_RESOURCE_TYPE);
  const apps = regroupApps(rows);
  const collectedAt = marker?.collectedAt ?? null;

  const untrustworthyReason = assessTrust({ rows, marker, now });

  return {
    apps,
    trustworthy: untrustworthyReason === null,
    untrustworthyReason,
    collectedAt,
  };
}

function assessTrust({
  rows,
  marker,
  now,
}: {
  rows: CheckResultRow[];
  marker: CheckResultRow | undefined;
  now: Date;
}): UntrustworthyReason | null {
  if (!marker) return 'no-marker';

  const evidence = asRecord(marker.evidence) as MarkerEvidence | null;
  if (!evidence || evidence.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return 'unsupported-schema';
  }
  if (evidence.complete !== true) return 'incomplete';
  if (typeof evidence.usersInspected !== 'number' || evidence.usersInspected <= 0) {
    return 'no-users-inspected';
  }
  if (now.getTime() - marker.collectedAt.getTime() > FRESHNESS_WINDOW_MS) {
    return 'stale';
  }
  // A consent failure means the run could not see grants at all, whatever else it reported.
  if (rows.some((row) => row.resourceId === SCOPE_CONSENT_RESOURCE_ID)) {
    return 'consent-failure';
  }

  return null;
}

/**
 * Rebuild one entry per app from the emitted rows, joining spill parts (`clientId#2`, `#3` …)
 * back together and expanding each grantee's scope indices against the row's catalogue.
 */
function regroupApps(rows: CheckResultRow[]): ObservedApp[] {
  const byClientId = new Map<string, ObservedApp>();
  // Last-write-wins per (app, userKey) so a grantee appearing twice cannot duplicate.
  const granteesByApp = new Map<string, Map<string, ObservedGrantee>>();

  for (const row of rows) {
    if (row.resourceType !== OAUTH_APP_RESOURCE_TYPE) continue;

    const evidence = asRecord(row.evidence) as AppEvidence | null;
    const clientId = evidence?.clientId;
    if (!evidence || typeof clientId !== 'string' || clientId === '') continue;

    let app = byClientId.get(clientId);
    if (!app) {
      app = {
        externalAppId: clientId,
        displayName: evidence.displayName ?? null,
        nativeApp: evidence.nativeApp === true,
        anonymous: evidence.anonymous === true,
        scopes: [],
        grantees: [],
      };
      byClientId.set(clientId, app);
      granteesByApp.set(clientId, new Map());
    }

    // A later part may carry a display name an earlier one lacked.
    app.displayName ??= evidence.displayName ?? null;

    const catalog = Array.isArray(evidence.scopeCatalog) ? evidence.scopeCatalog : [];
    const granteeMap = granteesByApp.get(clientId)!;

    for (const grantee of evidence.grantees ?? []) {
      const userKey = typeof grantee.userKey === 'string' ? grantee.userKey : null;
      const email = typeof grantee.email === 'string' ? grantee.email : null;
      if (!userKey && !email) continue;

      const scopes = (grantee.scopeIndices ?? [])
        .map((index) => catalog[index])
        .filter((scope): scope is string => typeof scope === 'string');

      granteeMap.set(userKey ?? `email:${email}`, {
        email: email ?? '',
        userKey: userKey ?? '',
        scopes,
      });
    }
  }

  for (const [clientId, app] of byClientId) {
    app.grantees = [...(granteesByApp.get(clientId)?.values() ?? [])];
    app.scopes = [...new Set(app.grantees.flatMap((grantee) => grantee.scopes))];
  }

  return [...byClientId.values()];
}
