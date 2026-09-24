import type { InboxItemKind, InboxSeverity } from '@/hooks/inbox-data';
import { Renew, Task, Unlink } from '@trycompai/design-system/icons';
import type { ComponentType } from 'react';

interface KindPresentation {
  icon: ComponentType<{ size?: number }>;
  /** Short label for the row badge. */
  label: string;
  /** Plural noun for summaries: "3 failing tasks". */
  noun: [singular: string, plural: string];
  /** Where the full list lives, relative to the organization root. */
  viewAllPath: string;
}

/** Display order for summaries and truncation notes. */
export const INBOX_KIND_ORDER: InboxItemKind[] = [
  'task-failed',
  'finding-regression',
  'connection-error',
];

export const INBOX_KINDS: Record<InboxItemKind, KindPresentation> = {
  'task-failed': {
    icon: Task,
    label: 'Failing task',
    noun: ['failing task', 'failing tasks'],
    viewAllPath: 'tasks?status=failed',
  },
  'finding-regression': {
    icon: Renew,
    label: 'Regression',
    noun: ['cloud regression', 'cloud regressions'],
    viewAllPath: 'cloud-tests',
  },
  'connection-error': {
    icon: Unlink,
    label: 'Integration',
    noun: ['broken integration', 'broken integrations'],
    viewAllPath: 'integrations',
  },
};

export const SEVERITY_LABEL: Record<InboxSeverity, string> = {
  critical: 'Critical',
  attention: 'Needs attention',
  routine: 'Routine',
};

export const SEVERITY_TONE: Record<InboxSeverity, string> = {
  critical: 'text-destructive',
  attention: 'text-warning',
  routine: 'text-muted-foreground',
};

export function countLabel({ kind, count }: { kind: InboxItemKind; count: number }): string {
  const [singular, plural] = INBOX_KINDS[kind].noun;
  return `${count} ${count === 1 ? singular : plural}`;
}
