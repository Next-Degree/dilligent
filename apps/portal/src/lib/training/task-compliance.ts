import {
  assessRequiredTraining,
  getTrainingGroup,
  type TrainingCompletionRecord,
  type TrainingGroupId,
} from '@trycompai/company/training';

/** Per group: null when the org does not require it, otherwise whether the member currently satisfies it. */
export type TrainingTaskCompliance = Record<TrainingGroupId, boolean | null>;

/**
 * Whether the member has done each training their org requires.
 *
 * A group counts when it is valid, or valid and due for renewal; an expired or
 * unfinished one does not. This reads the shared status logic rather than
 * counting rows, because a renewed member has one row per module per cycle.
 */
export function getTrainingTaskCompliance({
  requiredGroupIds,
  completions,
  now,
}: {
  requiredGroupIds: readonly TrainingGroupId[];
  completions: readonly TrainingCompletionRecord[];
  now: Date;
}): TrainingTaskCompliance {
  const result: TrainingTaskCompliance = { general: null, hipaa: null, ccpa: null };

  const progress = assessRequiredTraining({
    groups: requiredGroupIds.map((id) => getTrainingGroup(id)),
    completions,
    now,
  });
  for (const entry of progress) {
    result[entry.group.id] = entry.compliant;
  }

  return result;
}
