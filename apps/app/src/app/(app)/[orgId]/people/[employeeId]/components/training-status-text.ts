import type { TrainingGroupView } from '@/lib/training/training-view';

export type TrainingTone = 'muted' | 'success' | 'warning' | 'danger';

export interface TrainingStatusText {
  tone: TrainingTone;
  title: string;
  detail: string | null;
}

/**
 * What to tell an admin about one member's standing on a training group.
 *
 * Renewal wording matters here: a group that is due for renewal still counts
 * as complete (it keeps its certificate and its place in the score), while an
 * expired one no longer does and shows how far the renewal has got instead.
 */
export function describeTrainingStatus({
  view,
  formatDate,
}: {
  view: TrainingGroupView;
  formatDate: (date: Date) => string;
}): TrainingStatusText {
  const { status, modules } = view;
  const completed = modules.filter((module) => module.completedAt !== null).length;
  const total = modules.length;

  switch (status.status) {
    case 'incomplete':
      return { tone: 'muted', title: `${completed}/${total} Videos Completed`, detail: null };
    case 'valid':
      return {
        tone: 'success',
        title: 'All Training Complete',
        detail: `Completed on ${formatDate(status.completedAt)}. Valid until ${formatDate(status.validUntil)}.`,
      };
    case 'renewal_due':
      return {
        tone: 'warning',
        title: 'Renewal Due',
        detail: `Completed on ${formatDate(status.completedAt)}. Valid until ${formatDate(status.validUntil)}.`,
      };
    case 'expired':
      return {
        tone: 'danger',
        title: 'Training Expired',
        detail: `Expired on ${formatDate(status.validUntil)}. Renewal: ${completed}/${total} videos completed.`,
      };
  }
}
