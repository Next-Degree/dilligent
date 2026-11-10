import { groupForModule } from './catalog';
import { assessTrainingGroup, type TrainingCompletionRecord } from './status';

export type CompletionTarget =
  | { action: 'record'; cycle: number }
  | { action: 'ignore'; reason: 'unknown_module' | 'not_due' | 'already_completed' };

/**
 * Decide where, if anywhere, a member's completion of one module is recorded.
 *
 * Both completion write paths call this so they cannot disagree about which
 * cycle a completion belongs to. It never starts a renewal early (`not_due`),
 * and never re-stamps a module already finished in the active cycle.
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

  return { action: 'record', cycle: status.activeCycle };
}
