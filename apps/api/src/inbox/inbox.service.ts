import { Injectable, Logger } from '@nestjs/common';
import type { AuthContext } from '../auth/types';
import { resolveCallerPermissions } from './inbox-permissions';
import {
  compareInboxItems,
  type InboxItem,
  type InboxItemKind,
} from './inbox.types';
import { INBOX_SOURCES } from './sources';

/** Keeps one noisy source from burying the rest. */
export const PER_SOURCE_LIMIT = 50;

export interface InboxListResult {
  items: InboxItem[];
  /** True count per visible kind. Kinds the caller cannot see are absent. */
  totals: Partial<Record<InboxItemKind, number>>;
  /** Visible kinds whose source failed this request; absent from `totals`. */
  unavailable: InboxItemKind[];
}

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  async list({
    auth,
    limit,
  }: {
    auth: AuthContext;
    limit: number;
  }): Promise<InboxListResult> {
    const can = await resolveCallerPermissions(auth);
    const visible = INBOX_SOURCES.filter((source) =>
      source.requires.every(can),
    );

    // One source failing must not blank the whole inbox: report it instead.
    const settled = await Promise.allSettled(
      visible.map((source) =>
        source.collect({
          organizationId: auth.organizationId,
          limit: Math.min(limit, PER_SOURCE_LIMIT),
          auth,
        }),
      ),
    );

    const totals: Partial<Record<InboxItemKind, number>> = {};
    const unavailable: InboxItemKind[] = [];
    const collected: InboxItem[] = [];

    settled.forEach((result, index) => {
      const { kind } = visible[index];
      if (result.status === 'rejected') {
        unavailable.push(kind);
        this.logger.error(
          `Inbox source "${kind}" failed for organization ${auth.organizationId}`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
        return;
      }
      totals[kind] = result.value.total;
      collected.push(...result.value.items);
    });

    const items = collected.sort(compareInboxItems).slice(0, limit);
    return { items, totals, unavailable };
  }
}
