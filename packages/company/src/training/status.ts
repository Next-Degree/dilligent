import type { TrainingGroup } from './catalog';
import { DAY_MS, TRAINING_RENEWAL_WINDOW_DAYS } from './constants';

/** One member's row for one module in one cycle. A null `completedAt` is an assigned, unfinished row. */
export interface TrainingCompletionRecord {
  videoId: string;
  cycle: number;
  completedAt: Date | null;
}

/**
 * Where one member stands on one training group.
 *
 * - `valid`: a cycle is fully complete and not yet inside the renewal window.
 * - `renewal_due`: fully complete and still valid, but expiring within the
 *   renewal window. Still counts as compliant.
 * - `expired`: the latest fully complete cycle is older than the group's
 *   cadence. No longer counts as compliant.
 * - `incomplete`: no cycle has ever been fully completed.
 *
 * `cycle`, `completedAt` and `validUntil` describe the latest fully complete
 * cycle. `activeCycle` and `remainingModuleIds` describe the cycle a member
 * works on next: where their next completion is recorded, and what is left.
 */
export type TrainingStatus =
  | { status: 'valid'; cycle: number; completedAt: Date; validUntil: Date }
  | {
      status: 'renewal_due';
      cycle: number;
      completedAt: Date;
      validUntil: Date;
      activeCycle: number;
      remainingModuleIds: string[];
    }
  | {
      status: 'expired';
      cycle: number;
      completedAt: Date;
      validUntil: Date;
      activeCycle: number;
      remainingModuleIds: string[];
    }
  | { status: 'incomplete'; activeCycle: number; remainingModuleIds: string[] };

/** Completion dates keyed by cycle, then module. Only finished rows for modules of the group. */
function completionDatesByCycle({
  moduleIds,
  completions,
}: {
  moduleIds: readonly string[];
  completions: readonly TrainingCompletionRecord[];
}): Map<number, Map<string, Date>> {
  const groupModules = new Set<string>(moduleIds);
  const byCycle = new Map<number, Map<string, Date>>();

  for (const { videoId, cycle, completedAt } of completions) {
    if (!completedAt || !groupModules.has(videoId)) continue;
    const cycleDates = byCycle.get(cycle) ?? new Map<string, Date>();
    const existing = cycleDates.get(videoId);
    // The first completion stands, matching how the write paths never re-stamp.
    if (!existing || completedAt < existing) cycleDates.set(videoId, completedAt);
    byCycle.set(cycle, cycleDates);
  }

  return byCycle;
}

/**
 * Modules still to do in a cycle that is not finished. A module watched longer
 * ago than the lapse period (a year minus the renewal window) no longer counts: finishing the cycle with it
 * would leave the training expired the moment it was done, so the member
 * watches that one again instead.
 */
function missingModules({
  moduleIds,
  cycleDates,
  now,
  lapseMs,
}: {
  moduleIds: readonly string[];
  cycleDates: Map<string, Date> | undefined;
  now: Date;
  lapseMs: number;
}): string[] {
  return moduleIds.filter((moduleId) => {
    const date = cycleDates?.get(moduleId);
    return !date || now.getTime() - date.getTime() >= lapseMs;
  });
}

/**
 * The oldest and newest completion dates of a cycle, or null unless every
 * module of the group was finished in it while all of them were still within
 * the lapse period of each other. A cycle assembled from a module that had
 * already lapsed was never valid, so it does not count as finished: it stays
 * the cycle being worked on, with the lapsed module to redo.
 */
function completedSpan({
  moduleIds,
  cycleDates,
  lapseMs,
}: {
  moduleIds: readonly string[];
  cycleDates: Map<string, Date>;
  lapseMs: number;
}): { oldest: Date; newest: Date } | null {
  let oldest: Date | undefined;
  let newest: Date | undefined;

  for (const moduleId of moduleIds) {
    const date = cycleDates.get(moduleId);
    if (!date) return null;
    if (!oldest || date < oldest) oldest = date;
    if (!newest || date > newest) newest = date;
  }

  if (!oldest || !newest) return null;
  if (newest.getTime() - oldest.getTime() >= lapseMs) return null;
  return { oldest, newest };
}

/**
 * Judge one member against one training group.
 *
 * The validity window runs from the oldest module in the latest fully complete
 * cycle, so one early module cannot be left to age out while the rest are
 * fresh. The reported completion date is the module finished last, the same
 * date the completion certificate carries.
 */
export function assessTrainingGroup({
  group,
  completions,
  now,
}: {
  group: TrainingGroup;
  completions: readonly TrainingCompletionRecord[];
  now: Date;
}): TrainingStatus {
  const byCycle = completionDatesByCycle({ moduleIds: group.moduleIds, completions });
  const validityMs = group.cadenceDays * DAY_MS;
  // Progress in an unfinished training lapses a renewal window earlier than the
  // training itself would, so a training is never due for renewal on the day
  // it is finished.
  const lapseMs = (group.cadenceDays - TRAINING_RENEWAL_WINDOW_DAYS) * DAY_MS;

  let latest: { cycle: number; oldest: Date; newest: Date } | null = null;
  for (const [cycle, cycleDates] of byCycle) {
    const span = completedSpan({ moduleIds: group.moduleIds, cycleDates, lapseMs });
    if (span && (latest === null || cycle > latest.cycle)) {
      latest = { cycle, ...span };
    }
  }

  if (latest === null) {
    const activeCycle = byCycle.size > 0 ? Math.max(...byCycle.keys()) : 1;
    return {
      status: 'incomplete',
      activeCycle,
      remainingModuleIds: missingModules({
        moduleIds: group.moduleIds,
        cycleDates: byCycle.get(activeCycle),
        now,
        lapseMs,
      }),
    };
  }

  const validUntil = new Date(latest.oldest.getTime() + validityMs);
  const renewalOpensAt = new Date(validUntil.getTime() - TRAINING_RENEWAL_WINDOW_DAYS * DAY_MS);

  if (now < renewalOpensAt) {
    return { status: 'valid', cycle: latest.cycle, completedAt: latest.newest, validUntil };
  }

  const activeCycle = latest.cycle + 1;
  return {
    status: now < validUntil ? 'renewal_due' : 'expired',
    cycle: latest.cycle,
    completedAt: latest.newest,
    validUntil,
    activeCycle,
    remainingModuleIds: missingModules({
      moduleIds: group.moduleIds,
      cycleDates: byCycle.get(activeCycle),
      now,
      lapseMs,
    }),
  };
}

/** Whether a member currently satisfies the training: valid, or valid and due for renewal. */
export function isTrainingCompliant(
  status: TrainingStatus,
): status is Extract<TrainingStatus, { status: 'valid' | 'renewal_due' }> {
  return status.status === 'valid' || status.status === 'renewal_due';
}
