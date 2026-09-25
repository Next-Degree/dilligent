/**
 * Shared database-scope resolution for the Upstash checks.
 *
 * Every check answers the same questions before it can look at anything:
 * which databases can this key see, which of them did the customer scope the
 * automation to, and is the resulting evidence never accidentally quiet
 * about a database that was in scope but not checked. Answering them once
 * here keeps the failure wording identical across checks.
 */

import type { CheckContext } from '../../types';
import { remediationForReadFailure, toHttpReadFailure } from '../http-read-failure';
import { listUpstashDatabases } from './client';
import type { UpstashDatabase } from './types';
import {
  applyUpstashDatabaseFilter,
  parseUpstashDatabaseFilter,
  type UpstashDatabaseFilter,
} from './variables';

/** Per-database checks issue at least one request each — bound the run and say so. */
export const MAX_DATABASES_PER_RUN = 100;

export interface UpstashScope {
  databases: UpstashDatabase[];
  totalDatabaseCount: number;
  filter: UpstashDatabaseFilter;
  checkedAt: string;
}

export async function resolveUpstashScope(ctx: CheckContext): Promise<UpstashScope | null> {
  const checkedAt = new Date().toISOString();

  let databases: UpstashDatabase[];
  try {
    databases = await listUpstashDatabases(ctx);
  } catch (error) {
    const failure = toHttpReadFailure(error);
    ctx.fail({
      title: 'Failed to list Upstash databases',
      description: `Could not read the Upstash database list: ${failure.error}`,
      resourceType: 'upstash',
      resourceId: 'databases',
      severity: 'high',
      remediation: remediationForReadFailure(
        failure,
        'Confirm the Upstash email and API key are correct and the key has not been revoked, then re-run the check.',
      ),
      evidence: { error: failure.error, denied: failure.denied, checkedAt },
    });
    return null;
  }

  if (databases.length === 0) {
    ctx.fail({
      title: 'No Upstash databases found',
      description: 'The Upstash account has no Redis databases, so there is nothing to evidence.',
      resourceType: 'upstash',
      resourceId: 'databases',
      severity: 'medium',
      remediation:
        'Create a database in the Upstash Console, or remove this integration if it is not yet in use.',
      evidence: { checkedAt },
    });
    return null;
  }

  const filter = parseUpstashDatabaseFilter(ctx.variables);
  const scoped = applyUpstashDatabaseFilter(databases, filter);

  if (filter.mode !== 'all' && scoped.length === 0) {
    ctx.fail({
      title: 'Database filter matched no databases',
      description: `Filter mode "${filter.mode}" with ${filter.selectedIds.size} selected database(s) resolved to zero databases in scope. This usually means a selected database was deleted or renamed.`,
      resourceType: 'upstash',
      resourceId: 'database-filter',
      severity: 'medium',
      remediation:
        'Open the Configure sheet for this automation and review the selected Upstash databases.',
      evidence: {
        filterMode: filter.mode,
        selectedDatabaseIds: Array.from(filter.selectedIds),
        availableDatabaseIds: databases.map((db) => db.database_id),
        checkedAt,
      },
    });
    return null;
  }

  ctx.log(
    `Upstash scope resolved: ${scoped.length} of ${databases.length} database(s) (filter mode=${filter.mode})`,
  );

  return {
    databases: scoped,
    totalDatabaseCount: databases.length,
    filter,
    checkedAt,
  };
}

/**
 * Trim the scope to what one run will actually read, recording the
 * remainder as a finding. A coverage cap must never read as "everything
 * passed".
 */
export function limitDatabases(ctx: CheckContext, scope: UpstashScope): UpstashDatabase[] {
  const covered = scope.databases.slice(0, MAX_DATABASES_PER_RUN);
  const skipped = scope.databases.slice(MAX_DATABASES_PER_RUN);

  if (skipped.length > 0) {
    ctx.fail({
      title: `${skipped.length} database(s) not checked`,
      description: `This run covered ${covered.length} of ${scope.databases.length} databases in scope; the rest were not read.`,
      resourceType: 'upstash',
      resourceId: 'database-coverage',
      severity: 'low',
      remediation:
        'Narrow the database filter in the Configure sheet so every database you need evidence for is covered by a run.',
      evidence: {
        checkedDatabaseCount: covered.length,
        scopedDatabaseCount: scope.databases.length,
        skippedDatabaseIds: skipped.map((db) => db.database_id),
        maxDatabasesPerRun: MAX_DATABASES_PER_RUN,
        checkedAt: scope.checkedAt,
      },
    });
  }

  return covered;
}

/**
 * Identity fields every Upstash result repeats, so evidence rows are
 * comparable. Deliberately excludes `endpoint`, `password`, `rest_token` and
 * `read_only_rest_token` — the last three are live credentials, and even the
 * hostname-only `endpoint` is omitted to keep this helper safe to spread
 * without checkers needing to remember which fields are sensitive.
 */
export function databaseEvidence(database: UpstashDatabase): Record<string, unknown> {
  return {
    databaseId: database.database_id,
    databaseName: database.database_name ?? database.database_id,
    region: database.region ?? database.primary_region ?? null,
    type: database.type ?? database.db_type ?? null,
  };
}
