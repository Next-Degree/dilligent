import type { TrainingGroup } from './catalog';
import { assessTrainingGroup, isTrainingCompliant } from './status';
import type { TrainingCompletionRecord, TrainingStatus } from './status';

/** One member's standing on one required training group, ready to display or count. */
export interface RequiredTrainingProgress {
  group: TrainingGroup;
  status: TrainingStatus;
  /** Whether the member currently satisfies this group: valid, or valid and due for renewal. */
  compliant: boolean;
  /**
   * Modules finished toward the member's current requirement. A compliant
   * group counts every module (a renewal that is merely coming up does not
   * make last year's training any less done); an expired or unfinished group
   * counts only what is finished in the cycle they are working on now, so
   * progress never exceeds the total or double counts a renewal.
   */
  completedModules: number;
  totalModules: number;
}

/**
 * Assess one member against every training group their org requires.
 *
 * `completions` must be that member's rows only; use
 * {@link groupCompletionsByMember} to split a whole org's rows first.
 */
export function assessRequiredTraining({
  groups,
  completions,
  now,
}: {
  groups: readonly TrainingGroup[];
  completions: readonly TrainingCompletionRecord[];
  now: Date;
}): RequiredTrainingProgress[] {
  return groups.map((group) => {
    const status = assessTrainingGroup({ group, completions, now });
    const totalModules = group.moduleIds.length;
    const completedModules =
      status.status === 'valid' || status.status === 'renewal_due'
        ? totalModules
        : totalModules - status.remainingModuleIds.length;

    return {
      group,
      status,
      compliant: isTrainingCompliant(status),
      completedModules,
      totalModules,
    };
  });
}

/** Whether every required group is satisfied. Vacuously true when nothing is required. */
export function hasCompletedRequiredTraining(
  progress: readonly RequiredTrainingProgress[],
): boolean {
  return progress.every((entry) => entry.compliant);
}

/** Split an org's completion rows into per member lists, for per member assessment. */
export function groupCompletionsByMember<T extends { memberId: string }>(
  completions: readonly T[],
): Map<string, T[]> {
  const byMember = new Map<string, T[]>();

  for (const completion of completions) {
    const rows = byMember.get(completion.memberId);
    if (rows) {
      rows.push(completion);
    } else {
      byMember.set(completion.memberId, [completion]);
    }
  }

  return byMember;
}
