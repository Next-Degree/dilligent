/**
 * Security awareness training records for integration checks.
 *
 * The `@trycompai/integration-platform` package has no database of its own, so
 * checks that evidence training receive a host-supplied {@link TrainingProvider}.
 * This module is that host implementation, backed by Prisma.
 *
 * Used by the Dilligent security awareness training check.
 */

import type {
  TrainingParticipant,
  TrainingProvider,
} from '@trycompai/integration-platform';
import { GENERAL_TRAINING_VIDEO_IDS } from '@trycompai/company';
import { db } from '@db';
import { filterComplianceMembers } from '../../utils/compliance-filters';

/**
 * Build a {@link TrainingProvider} scoped to one organization.
 *
 * Participants are the population the People dashboard counts toward training
 * completion (active members with a compliance obligation), minus anyone whose
 * offboard date has passed: they have left, so they are no longer required to
 * hold current training. The query is deferred until a check asks for it.
 */
export function createTrainingProvider({
  organizationId,
}: {
  organizationId: string;
}): TrainingProvider {
  return {
    getSecurityAwarenessTraining: async () => {
      const now = new Date();
      const requiredModuleIds: string[] = [...GENERAL_TRAINING_VIDEO_IDS];

      const [organization, members] = await Promise.all([
        db.organization.findUnique({
          where: { id: organizationId },
          select: { securityTrainingStepEnabled: true },
        }),
        db.member.findMany({
          where: { organizationId, deactivated: false, isActive: true },
          select: {
            id: true,
            role: true,
            createdAt: true,
            onboardDate: true,
            offboardDate: true,
            user: { select: { email: true, name: true, role: true } },
          },
        }),
      ]);

      const current = members.filter(
        (member) =>
          !member.offboardDate || member.offboardDate.getTime() > now.getTime(),
      );
      const obligated = await filterComplianceMembers(current, organizationId);

      const completions =
        obligated.length === 0
          ? []
          : await db.employeeTrainingVideoCompletion.findMany({
              where: {
                memberId: { in: obligated.map((member) => member.id) },
                videoId: { in: requiredModuleIds },
                completedAt: { not: null },
              },
              select: { memberId: true, videoId: true, completedAt: true },
            });

      const completionsByMember = new Map<
        string,
        TrainingParticipant['completions']
      >();
      for (const { memberId, videoId, completedAt } of completions) {
        if (!completedAt) continue;
        const list = completionsByMember.get(memberId) ?? [];
        list.push({
          moduleId: videoId,
          completedAt: completedAt.toISOString(),
        });
        completionsByMember.set(memberId, list);
      }

      const participants = obligated.map((member): TrainingParticipant => ({
        id: member.id,
        email: member.user.email.trim().toLowerCase(),
        name: member.user.name?.trim() || null,
        joinedAt: (member.onboardDate ?? member.createdAt).toISOString(),
        completions: completionsByMember.get(member.id) ?? [],
      }));

      return {
        requiredModuleIds,
        portalTrainingEnabled:
          organization?.securityTrainingStepEnabled === true,
        participants,
      };
    },
  };
}
