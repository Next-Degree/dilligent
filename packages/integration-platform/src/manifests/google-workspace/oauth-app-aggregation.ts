import type { GoogleWorkspaceToken } from './types';
import type { TokensFanOutUser } from './tokens-fan-out';

/**
 * Grantees carried by a single result row before spilling into `#2`, `#3` …
 *
 * Check results are never pruned, so row size is a permanent cost. A 500-grantee row
 * lands at roughly 40–60KB with the scope catalogue below; without it, nearer 300KB.
 */
export const GRANTEES_PER_ROW = 500;

/**
 * Ceiling on spill rows for one app. Past this the app is truncated and the run marker
 * reports incomplete — visible truncation, never silent.
 */
export const MAX_SPILL_ROWS = 20;

export interface AggregatedGrantee {
  email: string;
  userKey: string;
  /** Indices into the row's `scopeCatalog`. Scope strings are ~60 chars and near-identical
   *  across grantees, so storing them once per app rather than once per person is the
   *  difference between a 40KB row and a 300KB one. */
  scopeIndices: number[];
}

export interface AggregatedApp {
  clientId: string;
  displayName?: string;
  nativeApp: boolean;
  anonymous: boolean;
  scopeCatalog: string[];
  grantees: AggregatedGrantee[];
}

export interface AggregatedAppRow {
  /** `clientId` for part 1, `clientId#2`, `clientId#3` … for spill rows. */
  resourceId: string;
  clientId: string;
  displayName?: string;
  nativeApp: boolean;
  anonymous: boolean;
  scopeCatalog: string[];
  grantees: AggregatedGrantee[];
  partNumber: number;
  partCount: number;
  /** Total grantees across all parts, so a single row reports the true count. */
  granteeCount: number;
  truncated: boolean;
}

/**
 * Group per-user grants into one entry per OAuth client.
 *
 * One row per app rather than per (user × app): a 500-person org averaging 20 apps would
 * otherwise write ~10,000 unpruned rows per daily run, and the materialiser loads them
 * uncapped on every pass.
 */
export function aggregateGrantsByApp(
  grantsByUser: Map<string, { user: TokensFanOutUser; tokens: GoogleWorkspaceToken[] }>,
): AggregatedApp[] {
  const apps = new Map<string, AggregatedApp>();
  // Per-app scope string -> catalogue index, so lookups stay O(1) while building.
  const scopeIndexByApp = new Map<string, Map<string, number>>();

  for (const { user, tokens } of grantsByUser.values()) {
    for (const token of tokens) {
      if (!token.clientId) {
        continue;
      }

      let app = apps.get(token.clientId);
      if (!app) {
        app = {
          clientId: token.clientId,
          displayName: token.displayText,
          nativeApp: token.nativeApp === true,
          anonymous: token.anonymous === true,
          scopeCatalog: [],
          grantees: [],
        };
        apps.set(token.clientId, app);
        scopeIndexByApp.set(token.clientId, new Map());
      }

      // A later token may carry a display name where an earlier one did not.
      app.displayName ??= token.displayText;

      const catalogIndex = scopeIndexByApp.get(token.clientId)!;
      const scopeIndices: number[] = [];
      for (const scope of token.scopes ?? []) {
        let index = catalogIndex.get(scope);
        if (index === undefined) {
          index = app.scopeCatalog.length;
          app.scopeCatalog.push(scope);
          catalogIndex.set(scope, index);
        }
        scopeIndices.push(index);
      }

      app.grantees.push({
        email: user.email,
        userKey: user.userKey,
        scopeIndices,
      });
    }
  }

  return [...apps.values()];
}

/**
 * Split each app into the rows that will actually be emitted, spilling past
 * `GRANTEES_PER_ROW` and stopping at `MAX_SPILL_ROWS`.
 *
 * The grantee count on every part is the app-wide total, so a reader holding one part
 * still knows how many people hold access.
 */
export function toAppRows(apps: AggregatedApp[]): AggregatedAppRow[] {
  const rows: AggregatedAppRow[] = [];

  for (const app of apps) {
    const totalGrantees = app.grantees.length;
    const neededParts = Math.max(1, Math.ceil(totalGrantees / GRANTEES_PER_ROW));
    const partCount = Math.min(neededParts, MAX_SPILL_ROWS);
    const truncated = neededParts > MAX_SPILL_ROWS;

    for (let part = 1; part <= partCount; part++) {
      const start = (part - 1) * GRANTEES_PER_ROW;
      rows.push({
        resourceId: part === 1 ? app.clientId : `${app.clientId}#${part}`,
        clientId: app.clientId,
        displayName: app.displayName,
        nativeApp: app.nativeApp,
        anonymous: app.anonymous,
        scopeCatalog: app.scopeCatalog,
        grantees: app.grantees.slice(start, start + GRANTEES_PER_ROW),
        partNumber: part,
        partCount,
        granteeCount: totalGrantees,
        truncated,
      });
    }
  }

  return rows;
}
