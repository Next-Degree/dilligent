import {
  assessRequiredTraining,
  groupCompletionsByMember,
  type TrainingCompletionRecord,
  type TrainingGroup,
  type TrainingGroupId,
} from '@trycompai/company';

interface RequirementCounts {
  completed: number;
  total: number;
}

/** Per member requirement progress shown on the People list. */
export interface TaskCompletion {
  completed: number;
  total: number;
  policies: RequirementCounts;
  /** General security awareness training. Zero totals when the org does not require it. */
  training: RequirementCounts;
  /** Present only for orgs that require the HIPAA training. */
  hipaa?: RequirementCounts;
  /** Present only for orgs that require the CCPA training. */
  ccpa?: RequirementCounts;
}

/**
 * Work out each member's progress on policies and on every required training
 * group.
 *
 * A group that currently counts (valid, or valid and due for renewal) shows
 * every module done. An expired or unfinished group shows only what is done in
 * the cycle the member is working on, so progress never double counts a
 * renewal against last year's rows.
 */
export function buildTaskCompletionMap({
  employees,
  policies,
  groups,
  completions,
  now,
}: {
  employees: ReadonlyArray<{ id: string }>;
  policies: ReadonlyArray<{ signedBy: string[] }>;
  groups: readonly TrainingGroup[];
  completions: ReadonlyArray<TrainingCompletionRecord & { memberId: string }>;
  now: Date;
}): Record<string, TaskCompletion> {
  const completionsByMember = groupCompletionsByMember(completions);
  const map: Record<string, TaskCompletion> = {};

  for (const employee of employees) {
    const policiesCompleted = policies.filter((policy) =>
      policy.signedBy.includes(employee.id),
    ).length;

    const progress = assessRequiredTraining({
      groups,
      completions: completionsByMember.get(employee.id) ?? [],
      now,
    });
    const countsFor = (id: TrainingGroupId): RequirementCounts | undefined => {
      const entry = progress.find((candidate) => candidate.group.id === id);
      return entry && { completed: entry.completedModules, total: entry.totalModules };
    };

    const hipaa = countsFor('hipaa');
    const ccpa = countsFor('ccpa');

    map[employee.id] = {
      completed:
        policiesCompleted + progress.reduce((sum, entry) => sum + entry.completedModules, 0),
      total: policies.length + progress.reduce((sum, entry) => sum + entry.totalModules, 0),
      policies: { completed: policiesCompleted, total: policies.length },
      training: countsFor('general') ?? { completed: 0, total: 0 },
      ...(hipaa && { hipaa }),
      ...(ccpa && { ccpa }),
    };
  }

  return map;
}
