import { db } from '@db';
import { loadActiveExceptionSet } from '../../cloud-security/finding-exceptions';
import type { InboxSource } from '../inbox-source';
import { inboxKey, type InboxItem } from '../inbox.types';

/**
 * How many of the most recent regressions to consider. Bounds the query on
 * orgs with long histories; past it, `total` is a lower bound.
 */
const SCAN_WINDOW = 500;

type Regression = {
  id: string;
  connectionId: string;
  checkId: string;
  resourceId: string;
  regressedAt: Date;
  daysClean: number | null;
  connection: { provider: { slug: string; name: string } };
};

type FindingRef = Pick<Regression, 'connectionId' | 'checkId' | 'resourceId'>;

const findingKey = (ref: FindingRef): string =>
  `${ref.connectionId}\u0000${ref.checkId}\u0000${ref.resourceId}`;

/** Keep only the newest regression per finding (input is newest-first). */
function latestPerFinding(regressions: Regression[]): Regression[] {
  const seen = new Set<string>();
  return regressions.filter((regression) => {
    const key = findingKey(regression);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toItem(regression: Regression): InboxItem {
  const { provider } = regression.connection;
  const since =
    regression.daysClean === null
      ? 'failing again after being resolved'
      : `failing again after ${regression.daysClean} days clean`;
  return {
    key: inboxKey({ kind: 'finding-regression', entityId: regression.id }),
    kind: 'finding-regression',
    severity: 'critical',
    title: regression.checkId,
    detail: `${provider.name} · ${regression.resourceId} — ${since}`,
    path: `cloud-tests?provider=${encodeURIComponent(provider.slug)}`,
    occurredAt: regression.regressedAt,
    assigneeMemberId: null,
  };
}

/**
 * Cloud findings that were resolved and have since failed again — written by
 * CloudReconciliationService and otherwise visible only in one connection's
 * History tab. A regression is dropped once a later resolution exists for the
 * same finding, or while an active exception covers it, so only fixes that
 * still haven't stuck are shown.
 */
export const findingRegressionSource: InboxSource = {
  kind: 'finding-regression',
  requires: [{ resource: 'integration', action: 'read' }],

  async collect({ organizationId, limit }) {
    const recent = await db.findingRegression.findMany({
      // A paused or disconnected connection is no longer scanned, so its
      // regressions can never resolve; broken ones surface as connection-error.
      where: { organizationId, connection: { status: 'active' } },
      orderBy: { regressedAt: 'desc' },
      take: SCAN_WINDOW,
      select: {
        id: true,
        connectionId: true,
        checkId: true,
        resourceId: true,
        regressedAt: true,
        daysClean: true,
        connection: {
          select: { provider: { select: { slug: true, name: true } } },
        },
      },
    });
    if (recent.length === 0) return { items: [], total: 0 };

    // Exceptions are applied when results are read, not written: an excepted
    // finding keeps failing in the raw results and never gets a resolution,
    // so it has to be filtered here, the same way cloud-tests hides it.
    const exceptions = await loadActiveExceptionSet(organizationId);
    const candidates = latestPerFinding(recent).filter(
      (regression) =>
        !exceptions.has(
          regression.connectionId,
          regression.checkId,
          regression.resourceId,
        ),
    );
    if (candidates.length === 0) return { items: [], total: 0 };
    const oldest = candidates[candidates.length - 1].regressedAt;

    const laterResolutions = await db.findingResolution.findMany({
      where: {
        organizationId,
        connectionId: {
          in: [...new Set(candidates.map((r) => r.connectionId))],
        },
        checkId: { in: [...new Set(candidates.map((r) => r.checkId))] },
        resolvedAt: { gt: oldest },
      },
      select: {
        connectionId: true,
        checkId: true,
        resourceId: true,
        resolvedAt: true,
      },
    });

    const lastResolvedAt = new Map<string, Date>();
    for (const resolution of laterResolutions) {
      const key = findingKey(resolution);
      const current = lastResolvedAt.get(key);
      if (!current || resolution.resolvedAt > current) {
        lastResolvedAt.set(key, resolution.resolvedAt);
      }
    }

    const stillFailing = candidates.filter((regression) => {
      const resolvedAt = lastResolvedAt.get(findingKey(regression));
      return !resolvedAt || resolvedAt <= regression.regressedAt;
    });

    return {
      items: stillFailing.slice(0, limit).map(toItem),
      total: stillFailing.length,
    };
  },
};
