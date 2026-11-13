import { db } from '@db';
import {
  assessTrainingGroup,
  getTrainingGroup,
  type TrainingGroupId,
  type TrainingStatus,
} from '@trycompai/company';

/** Every completion row a member has, across all training groups and cycles. */
export function listMemberCompletions(memberId: string) {
  return db.employeeTrainingVideoCompletion.findMany({ where: { memberId } });
}

/**
 * Record a module as completed in the given cycle.
 *
 * A single atomic upsert on the (memberId, videoId, cycle) unique: a
 * find-then-create races under concurrent requests, where both callers see no
 * row, both create, and the second trips the unique constraint. The empty
 * update leaves an existing row untouched, so a finished module is never
 * re-stamped; only a row that was assigned but never finished gets stamped.
 */
export async function recordModuleCompletion({
  memberId,
  videoId,
  cycle,
}: {
  memberId: string;
  videoId: string;
  cycle: number;
}) {
  const record = await db.employeeTrainingVideoCompletion.upsert({
    where: { memberId_videoId_cycle: { memberId, videoId, cycle } },
    create: { memberId, videoId, cycle, completedAt: new Date() },
    update: {},
  });

  if (record.completedAt) return record;

  return db.employeeTrainingVideoCompletion.update({
    where: { id: record.id },
    data: { completedAt: new Date() },
  });
}

/** Where a member currently stands on one training group. */
export async function getGroupStatus({
  memberId,
  groupId,
  now = new Date(),
}: {
  memberId: string;
  groupId: TrainingGroupId;
  now?: Date;
}): Promise<TrainingStatus> {
  const completions = await listMemberCompletions(memberId);
  return assessTrainingGroup({
    group: getTrainingGroup(groupId),
    completions,
    now,
  });
}

/**
 * When the member finished their latest fully completed cycle of a group, or
 * null if they never have. Expired cycles still count: a certificate records
 * a completion that really happened, even once it has stopped being current.
 */
export async function getLatestCompletionDate({
  memberId,
  groupId,
}: {
  memberId: string;
  groupId: TrainingGroupId;
}): Promise<Date | null> {
  const status = await getGroupStatus({ memberId, groupId });
  return status.status === 'incomplete' ? null : status.completedAt;
}
