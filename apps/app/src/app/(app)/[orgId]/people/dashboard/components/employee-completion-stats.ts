import {
  assessRequiredTraining,
  groupCompletionsByMember,
  type TrainingCompletionRecord,
  type TrainingGroup,
  type TrainingGroupId,
} from '@trycompai/company/training';

/** One member's progress on one required training group. */
export interface EmployeeGroupStat {
  id: TrainingGroupId;
  completed: number;
  total: number;
}

export interface EmployeeTaskStats {
  id: string;
  name: string;
  email: string;
  totalTasks: number;
  policiesCompleted: number;
  policiesTotal: number;
  /** Modules finished across every required training group. */
  trainingCompleted: number;
  trainingTotal: number;
  groups: EmployeeGroupStat[];
  overallPercentage: number;
}

/**
 * Per employee completion for the People dashboard.
 *
 * Training counts come from the shared status logic, not from counting rows: a
 * member with a finished first cycle and a renewal has two rows per module, and
 * a group that is merely due for renewal still counts as done. An expired or
 * unfinished group shows only what is done in the cycle being worked on.
 */
export function buildEmployeeStats({
  employees,
  policies,
  completions,
  groups,
  now,
}: {
  employees: ReadonlyArray<{ id: string; user: { name: string | null; email: string } }>;
  policies: ReadonlyArray<{ signedBy: string[] }>;
  completions: ReadonlyArray<TrainingCompletionRecord & { memberId: string }>;
  groups: readonly TrainingGroup[];
  now: Date;
}): EmployeeTaskStats[] {
  const completionsByMember = groupCompletionsByMember(completions);

  return employees.map((employee) => {
    const policiesCompleted = policies.filter((policy) =>
      policy.signedBy.includes(employee.id),
    ).length;

    const progress = assessRequiredTraining({
      groups,
      completions: completionsByMember.get(employee.id) ?? [],
      now,
    });
    const trainingCompleted = progress.reduce((sum, entry) => sum + entry.completedModules, 0);
    const trainingTotal = progress.reduce((sum, entry) => sum + entry.totalModules, 0);

    const totalTasks = policies.length + trainingTotal;
    const completedTasks = policiesCompleted + trainingCompleted;

    return {
      id: employee.id,
      name: employee.user.name || employee.user.email.split('@')[0] || employee.user.email,
      email: employee.user.email,
      totalTasks,
      policiesCompleted,
      policiesTotal: policies.length,
      trainingCompleted,
      trainingTotal,
      groups: progress.map((entry) => ({
        id: entry.group.id,
        completed: entry.completedModules,
        total: entry.totalModules,
      })),
      overallPercentage: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
    };
  });
}

/** Short summary of a group's progress for the dashboard's per employee line. */
export function describeGroupProgress({ id, completed, total }: EmployeeGroupStat): string {
  if (id === 'hipaa') return `HIPAA ${completed >= total ? 'done' : 'pending'}`;
  if (id === 'ccpa') return `CCPA ${completed}/${total}`;
  return `${completed}/${total} training`;
}
