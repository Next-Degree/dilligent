import { groupForModule } from './catalog';
import { assessTrainingGroup, type TrainingCompletionRecord } from './status';

export type CompletionTarget =
  | {
      action: 'record';
      cycle: number;
      /**
       * The module already has a completion in this cycle, but one too old to
       * count. Both write paths overwrite its date, which they otherwise never do.
       */
      refreshesStale: boolean;
    }
  | { action: 'ignore'; reason: 'unknown_module' | 'not_due' | 'already_completed' };

/**
 * The member's row for a module in its highest cycle, i.e. the one that
 * reflects where they are now. Generic so callers keep their full row type
 * (ids and all) rather than the narrow completion record.
 */
export function latestCompletionFor<T extends { videoId: string; cycle: number }>({
  completions,
  videoId,
}: {
  completions: readonly T[];
  videoId: string;
}): T | undefined {
  let latest: T | undefined;

  for (const completion of completions) {
    if (completion.videoId !== videoId) continue;
    if (!latest || completion.cycle > latest.cycle) latest = completion;
  }

  return latest;
}

/**
 * Decide where, if anywhere, a member's completion of one module is recorded.
 *
 * Both completion write paths call this so they cannot disagree about which
 * cycle a completion belongs to. It never starts a renewal early (`not_due`),
 * and never re-stamps a module already finished in the active cycle, except
 * one finished too long ago to count (`refreshesStale`).
 */
export function resolveCompletionTarget({
  moduleId,
  completions,
  now,
}: {
  moduleId: string;
  completions: readonly TrainingCompletionRecord[];
  now: Date;
}): CompletionTarget {
  const group = groupForModule(moduleId);
  if (!group) return { action: 'ignore', reason: 'unknown_module' };

  const status = assessTrainingGroup({ group, completions, now });
  if (status.status === 'valid') return { action: 'ignore', reason: 'not_due' };
  if (!status.remainingModuleIds.includes(moduleId)) {
    return { action: 'ignore', reason: 'already_completed' };
  }

  const existing = completions.find(
    (completion) => completion.videoId === moduleId && completion.cycle === status.activeCycle,
  );

  return {
    action: 'record',
    cycle: status.activeCycle,
    refreshesStale: Boolean(existing?.completedAt),
  };
}
