// Shared by the server page and the client hook, so it must not be a client module.

export type InboxItemKind = 'task-failed' | 'finding-regression' | 'connection-error';

export type InboxSeverity = 'critical' | 'attention' | 'routine';

export interface InboxItem {
  key: string;
  kind: InboxItemKind;
  severity: InboxSeverity;
  title: string;
  detail: string;
  /** Path relative to the organization root, e.g. `tasks/tsk_abc`. */
  path: string;
  occurredAt: string;
  assigneeMemberId: string | null;
}

export interface InboxData {
  items: InboxItem[];
  /** True count per kind the caller can see. Kinds they cannot see are absent. */
  totals: Partial<Record<InboxItemKind, number>>;
}

export interface InboxApiResponse {
  data: InboxItem[];
  count: number;
  totals: Partial<Record<InboxItemKind, number>>;
}

export const INBOX_ENDPOINT = '/v1/inbox';

export function toInboxData(response: InboxApiResponse | undefined): InboxData | undefined {
  if (!response) return undefined;
  return {
    items: Array.isArray(response.data) ? response.data : [],
    totals: response.totals ?? {},
  };
}
