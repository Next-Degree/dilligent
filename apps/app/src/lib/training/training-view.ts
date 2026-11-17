import {
  assessTrainingGroup,
  type TrainingCompletionRecord,
  type TrainingGroup,
  type TrainingStatus,
} from '@trycompai/company';

/** One module of a group and when the member finished it, in the cycle being shown. */
export interface TrainingModuleView {
  videoId: string;
  completedAt: Date | null;
}

/** What to show an admin about one member's standing on one training group. */
export interface TrainingGroupView {
  group: TrainingGroup;
  status: TrainingStatus;
  /** The cycle the modules below are read from. */
  displayCycle: number;
  modules: TrainingModuleView[];
}

/**
 * Build the per member view of a training group.
 *
 * A group that currently counts (valid, or valid and due for renewal) shows
 * the cycle that made it count, so last year's training stays visibly done
 * until it really expires. Once it has expired, or was never finished, the
 * modules shown are the ones for the cycle the member is working on now, so
 * progress toward the renewal is not hidden behind the expired one.
 */
export function buildTrainingGroupView({
  group,
  completions,
  now,
}: {
  group: TrainingGroup;
  completions: readonly TrainingCompletionRecord[];
  now: Date;
}): TrainingGroupView {
  const status = assessTrainingGroup({ group, completions, now });
  const displayCycle =
    status.status === 'valid' || status.status === 'renewal_due'
      ? status.cycle
      : status.activeCycle;

  // In a cycle that does not count yet, a module the status still lists as
  // remaining is shown as to do, even if it has an old completion: it was
  // watched too long ago to count and has to be watched again.
  const remaining = new Set(
    status.status === 'valid' || status.status === 'renewal_due' ? [] : status.remainingModuleIds,
  );

  const modules = group.moduleIds.map((videoId) => ({
    videoId,
    completedAt: remaining.has(videoId)
      ? null
      : (completions.find(
          (completion) => completion.videoId === videoId && completion.cycle === displayCycle,
        )?.completedAt ?? null),
  }));

  return { group, status, displayCycle, modules };
}
