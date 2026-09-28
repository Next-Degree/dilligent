import type { AuthContext } from '../auth/types';
import type { InboxItem, InboxItemKind } from './inbox.types';

export interface InboxSourceContext {
  organizationId: string;
  /** Maximum items to return. `total` must still report the true count. */
  limit: number;
  auth: AuthContext;
}

export interface InboxSourceResult {
  items: InboxItem[];
  total: number;
}

/**
 * One kind of signal feeding the inbox. A source runs only when the caller
 * holds every permission in `requires`, so a source must never return data
 * outside what those permissions already expose elsewhere in the product.
 */
export interface InboxSource {
  kind: InboxItemKind;
  requires: ReadonlyArray<{ resource: string; action: string }>;
  collect(ctx: InboxSourceContext): Promise<InboxSourceResult>;
}
