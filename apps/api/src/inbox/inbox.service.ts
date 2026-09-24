import { Injectable } from '@nestjs/common';
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
}

@Injectable()
export class InboxService {
  async list({
    auth,
    limit,
  }: {
    auth: AuthContext;
    limit: number;
  }): Promise<InboxListResult> {
    const can = await resolveCallerPermissions(auth);
    const visible = INBOX_SOURCES.filter((source) =>
      source.requires.every(({ resource, action }) => can(resource, action)),
    );

    const results = await Promise.all(
      visible.map((source) =>
        source.collect({
          organizationId: auth.organizationId,
          limit: Math.min(limit, PER_SOURCE_LIMIT),
          auth,
        }),
      ),
    );

    const totals: Partial<Record<InboxItemKind, number>> = {};
    visible.forEach((source, index) => {
      totals[source.kind] = results[index].total;
    });

    const items = results
      .flatMap((result) => result.items)
      .sort(compareInboxItems)
      .slice(0, limit);

    return { items, totals };
  }
}
