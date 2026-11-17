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
 * The latest completion of each required module, per renewal round. Completions
 * with no cycle all belong to round 1, so a host that does not renew training
 * is judged exactly as before: on each module's latest completion.
 */
function latestByCycle({
  completions,
  requiredModuleIds,
}: {
  completions: TrainingModuleCompletion[];
  requiredModuleIds: string[];
}): Map<number, Map<string, string>> {
  const rowsByCycle = new Map<number, TrainingModuleCompletion[]>();
  for (const completion of completions) {
    const cycle = completion.cycle ?? 1;
    rowsByCycle.set(cycle, [...(rowsByCycle.get(cycle) ?? []), completion]);
  }

  return new Map(
    [...rowsByCycle].map(([cycle, rows]) => [
      cycle,
      latestRequiredCompletions({ completions: rows, requiredModuleIds }),
    ]),
  );
}

/**
 * Judge one participant against the required modules.
 *
 * A renewal round only counts once every module was finished in it, and the
 * highest such round is the one judged. Every module must fall inside the
 * validity window, so the window runs from the oldest module of that round:
 * retaking one part does not renew the others, and renewing only the stale
 * part of an old round does not rescue it. The reported completion date is the
 * module finished last, the same date the completion certificate carries.
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
  const byCycle = latestByCycle({
    completions: participant.completions,
    requiredModuleIds,
  });

  let finished: { cycle: number; completedAt: string; validUntil: Date } | null = null;
  for (const [cycle, latest] of byCycle) {
    const isComplete = requiredModuleIds.every((id) => latest.has(id));
    const dates = [...latest.values()].sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    );
    const oldest = dates[0];
    const newest = dates[dates.length - 1];
    if (!isComplete || !oldest || !newest) continue;
    if (finished && cycle <= finished.cycle) continue;

    finished = { cycle, completedAt: newest, validUntil: addDays(oldest, TRAINING_VALIDITY_DAYS) };
  }

  if (finished && finished.validUntil > now) {
    return {
      status: 'complete',
      completedAt: finished.completedAt,
      validUntil: finished.validUntil.toISOString(),
    };
  }

  // What is left to do is judged against the round being worked on: the highest
  // one with any completion, or everything when nothing was ever finished.
  const activeCycle = byCycle.size > 0 ? Math.max(...byCycle.keys()) : null;
  const missingModuleIds = requiredModuleIds.filter(
    (id) => activeCycle === null || !byCycle.get(activeCycle)?.has(id),
  );

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
