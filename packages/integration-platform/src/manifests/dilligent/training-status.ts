import type { TrainingModuleCompletion, TrainingParticipant } from '../../training-types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Security awareness training is annual: a completion counts for 12 months. */
export const TRAINING_VALIDITY_DAYS = 365;

/** New members get this long to finish training before they fail the check. */
export const ONBOARDING_GRACE_DAYS = 30;

/**
 * Where one person stands on security awareness training.
 *
 * - `complete`: every required module finished within the validity window.
 * - `onboarding`: not complete, but joined recently enough to still be inside
 *   the grace period.
 * - `expired`: every module finished, but at least one longer ago than the
 *   validity window.
 * - `incomplete`: at least one required module never finished.
 */
export type TrainingAssessment =
  | { status: 'complete'; completedAt: string; validUntil: string }
  | { status: 'onboarding'; graceEndsAt: string; missingModuleIds: string[] }
  | { status: 'expired'; completedAt: string; expiredAt: string }
  | { status: 'incomplete'; missingModuleIds: string[] };

const addDays = (iso: string, days: number): Date =>
  new Date(new Date(iso).getTime() + days * DAY_MS);

/**
 * The latest completion of each required module. Hosts send one row per
 * module today, but taking the latest keeps a future retake from being judged
 * on the original attempt.
 */
function latestRequiredCompletions({
  completions,
  requiredModuleIds,
}: {
  completions: TrainingModuleCompletion[];
  requiredModuleIds: string[];
}): Map<string, string> {
  const required = new Set(requiredModuleIds);
  const latest = new Map<string, string>();
  for (const { moduleId, completedAt } of completions) {
    if (!required.has(moduleId)) continue;
    if (Number.isNaN(new Date(completedAt).getTime())) continue;
    const existing = latest.get(moduleId);
    if (!existing || new Date(completedAt) > new Date(existing)) {
      latest.set(moduleId, completedAt);
    }
  }
  return latest;
}

/**
 * Judge one participant against the required modules.
 *
 * Every module must fall inside the validity window, so the window runs from
 * the oldest module: retaking one part does not renew the others. The reported
 * completion date is the module finished last, the same date the completion
 * certificate carries.
 */
export function assessTraining({
  participant,
  requiredModuleIds,
  now,
}: {
  participant: TrainingParticipant;
  requiredModuleIds: string[];
  now: Date;
}): TrainingAssessment {
  const latest = latestRequiredCompletions({
    completions: participant.completions,
    requiredModuleIds,
  });
  const missingModuleIds = requiredModuleIds.filter((id) => !latest.has(id));

  const dates = [...latest.values()].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const oldest = dates[0];
  const newest = dates[dates.length - 1];
  const finished =
    missingModuleIds.length === 0 && oldest && newest
      ? { completedAt: newest, validUntil: addDays(oldest, TRAINING_VALIDITY_DAYS) }
      : null;

  if (finished && finished.validUntil > now) {
    return {
      status: 'complete',
      completedAt: finished.completedAt,
      validUntil: finished.validUntil.toISOString(),
    };
  }

  const graceEndsAt = addDays(participant.joinedAt, ONBOARDING_GRACE_DAYS);
  if (graceEndsAt > now) {
    return {
      status: 'onboarding',
      graceEndsAt: graceEndsAt.toISOString(),
      missingModuleIds,
    };
  }

  if (finished) {
    return {
      status: 'expired',
      completedAt: finished.completedAt,
      expiredAt: finished.validUntil.toISOString(),
    };
  }

  return { status: 'incomplete', missingModuleIds };
}
