import {
  assessTrainingGroup,
  getTrainingGroup,
  type TrainingCompletionRecord,
  type TrainingGroupId,
  type TrainingStatus,
} from '@trycompai/company/training';

/** Where the member stands on one training group, for the screens that let them do it. */
export interface GroupProgress {
  status: TrainingStatus;
  /**
   * Modules to show as done. A valid group shows every module. Anything else
   * shows only what is finished in the cycle being worked on, so a renewal
   * starts from nothing even though last year's rows still exist.
   */
  completedModuleIds: ReadonlySet<string>;
  /** Whether the member currently satisfies the group: valid, or valid and due for renewal. */
  isSatisfied: boolean;
  /** Every module is done and nothing is left to do: valid, not merely satisfied. */
  isFullyDone: boolean;
}

export function getGroupProgress({
  groupId,
  completions,
  now,
}: {
  groupId: TrainingGroupId;
  completions: readonly TrainingCompletionRecord[];
  now: Date;
}): GroupProgress {
  const group = getTrainingGroup(groupId);
  const status = assessTrainingGroup({ group, completions, now });

  if (status.status === 'valid') {
    return {
      status,
      completedModuleIds: new Set(group.moduleIds),
      isSatisfied: true,
      isFullyDone: true,
    };
  }

  const remaining = new Set(status.remainingModuleIds);

  return {
    status,
    completedModuleIds: new Set(group.moduleIds.filter((id) => !remaining.has(id))),
    isSatisfied: status.status === 'renewal_due',
    isFullyDone: false,
  };
}
