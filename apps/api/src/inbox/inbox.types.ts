/** How urgently an item needs a human. Drives ranking and the row's badge. */
export type InboxSeverity = 'critical' | 'attention' | 'routine';

export type InboxItemKind =
  'task-failed' | 'finding-regression' | 'connection-error';

export interface InboxItem {
  /**
   * Stable across requests. Per-viewer read/snooze state will be stored against
   * this key, so changing its format orphans that state — bump
   * INBOX_KEY_VERSION and migrate rather than editing it in place.
   */
  key: string;
  kind: InboxItemKind;
  severity: InboxSeverity;
  title: string;
  detail: string;
  /** Web-app path relative to the organization root, e.g. `tasks/tsk_abc`. */
  path: string;
  /** When the condition was most recently observed. */
  occurredAt: Date;
  assigneeMemberId: string | null;
}

export const INBOX_KEY_VERSION = 'v1';

export function inboxKey({
  kind,
  entityId,
}: {
  kind: InboxItemKind;
  entityId: string;
}): string {
  return `${INBOX_KEY_VERSION}:${kind}:${entityId}`;
}

const SEVERITY_RANK: Record<InboxSeverity, number> = {
  critical: 0,
  attention: 1,
  routine: 2,
};

/** Most severe first, then most recent first. */
export function compareInboxItems(a: InboxItem, b: InboxItem): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  return b.occurredAt.getTime() - a.occurredAt.getTime();
}
