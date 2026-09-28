import { db } from '@db';
import type { InboxSource } from '../inbox-source';
import { inboxKey, type InboxItem } from '../inbox.types';

const MAX_DETAIL_LENGTH = 280;
const FALLBACK_DETAIL =
  'Open the integration to see what went wrong and reconnect it.';

function toDetail(errorMessage: string | null): string {
  const message = errorMessage?.trim();
  if (!message) return FALLBACK_DETAIL;
  if (message.length <= MAX_DETAIL_LENGTH) return message;
  return `${message.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
}

/**
 * Integrations whose connection is in `error` — typically a revoked or
 * expired credential. Nothing else in the product surfaces these, while every
 * check bound to the connection quietly stops producing evidence.
 */
export const connectionErrorSource: InboxSource = {
  kind: 'connection-error',
  requires: [{ resource: 'integration', action: 'read' }],

  async collect({ organizationId, limit }) {
    const where = { organizationId, status: 'error' as const };

    const [connections, total] = await Promise.all([
      db.integrationConnection.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          errorMessage: true,
          updatedAt: true,
          provider: { select: { slug: true, name: true } },
        },
      }),
      db.integrationConnection.count({ where }),
    ]);

    const items = connections.map((connection): InboxItem => ({
      key: inboxKey({ kind: 'connection-error', entityId: connection.id }),
      kind: 'connection-error',
      severity: 'critical',
      title: `${connection.provider.name} connection is failing`,
      detail: toDetail(connection.errorMessage),
      path: `integrations/${connection.provider.slug}`,
      occurredAt: connection.updatedAt,
      assigneeMemberId: null,
    }));

    return { items, total };
  },
};
