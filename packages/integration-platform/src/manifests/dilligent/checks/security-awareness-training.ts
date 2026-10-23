import { TASK_TEMPLATES } from '../../../task-mappings';
import type { TrainingParticipant } from '../../../training-types';
import type { CheckContext, IntegrationCheck } from '../../../types';
import {
  ONBOARDING_GRACE_DAYS,
  TRAINING_VALIDITY_DAYS,
  assessTraining,
  type TrainingAssessment,
} from '../training-status';

const RESOURCE_TYPE = 'member';

const INCOMPLETE_REMEDIATION =
  'Ask this person to sign in to the employee portal and finish every part of the security awareness training. The check passes on its next run.';

const EXPIRED_REMEDIATION = `Security awareness training must be repeated every ${TRAINING_VALIDITY_DAYS} days. Have this person complete the training again. The employee portal cannot yet reset a finished training, so until it can, keep the new completion record outside Dilligent and add an exception to this finding.`;

const label = (participant: TrainingParticipant): string =>
  participant.name ? `${participant.name} (${participant.email})` : participant.email;

const dateOnly = (iso: string): string => iso.slice(0, 10);

function describeAssessment({ assessment, who }: { assessment: TrainingAssessment; who: string }): {
  title: string;
  description: string;
} {
  switch (assessment.status) {
    case 'complete':
      return {
        title: `Security awareness training complete: ${who}`,
        description: `${who} finished every part of the security awareness training on ${dateOnly(assessment.completedAt)}. It counts until ${dateOnly(assessment.validUntil)}.`,
      };
    case 'onboarding':
      return {
        title: `Security awareness training due (onboarding): ${who}`,
        description: `${who} joined recently and has until ${dateOnly(assessment.graceEndsAt)} to finish the security awareness training (${ONBOARDING_GRACE_DAYS}-day onboarding window).`,
      };
    case 'expired':
      return {
        title: `Security awareness training expired: ${who}`,
        description: `${who} finished the security awareness training on ${dateOnly(assessment.completedAt)}, but it stopped counting on ${dateOnly(assessment.expiredAt)}: every part must have been completed within the last ${TRAINING_VALIDITY_DAYS} days.`,
      };
    case 'incomplete':
      return {
        title: `Security awareness training incomplete: ${who}`,
        description: `${who} has not finished the security awareness training. Unfinished parts: ${assessment.missingModuleIds.join(', ')}.`,
      };
  }
}

/** Records the participant's result. Returns true when their training is complete. */
function judgeParticipant(
  ctx: CheckContext,
  {
    participant,
    requiredModuleIds,
    now,
  }: { participant: TrainingParticipant; requiredModuleIds: string[]; now: Date },
): boolean {
  const assessment = assessTraining({ participant, requiredModuleIds, now });
  const { title, description } = describeAssessment({ assessment, who: label(participant) });
  const evidence = {
    source: 'dilligent-employee-portal',
    memberId: participant.id,
    email: participant.email,
    name: participant.name,
    joinedAt: participant.joinedAt,
    requiredModules: requiredModuleIds,
    completedModules: participant.completions.filter((c) => requiredModuleIds.includes(c.moduleId)),
    ...assessment,
    checkedAt: now.toISOString(),
  };

  if (assessment.status === 'complete' || assessment.status === 'onboarding') {
    ctx.pass({
      title,
      description,
      resourceType: RESOURCE_TYPE,
      resourceId: participant.id,
      evidence,
    });
    return assessment.status === 'complete';
  }

  ctx.fail({
    title,
    description,
    resourceType: RESOURCE_TYPE,
    resourceId: participant.id,
    severity: 'medium',
    remediation: assessment.status === 'expired' ? EXPIRED_REMEDIATION : INCOMPLETE_REMEDIATION,
    evidence,
  });
  return false;
}

/**
 * Security Awareness Training
 *
 * Reads training completions straight from the employee portal and judges
 * every person who is required to take the training: finished within the last
 * year passes, a recent joiner inside the onboarding window passes as due, and
 * anyone else fails.
 *
 * Maps to: Security Awareness Training
 */
export const securityAwarenessTrainingCheck: IntegrationCheck = {
  id: 'dilligent-security-awareness-training',
  name: 'Security Awareness Training',
  description: `Verify every person has completed the employee portal security awareness training within the last ${TRAINING_VALIDITY_DAYS} days`,
  service: 'people',
  taskMapping: TASK_TEMPLATES.securityAwarenessTraining,
  defaultSeverity: 'medium',

  run: async (ctx: CheckContext) => {
    if (!ctx.training) {
      // Only hosts without database access omit it. Throwing marks the run as
      // errored rather than failing the task over a gap on our side.
      throw new Error('Training records are not available to this check run');
    }

    const now = new Date();
    const records = await ctx.training.getSecurityAwarenessTraining();
    if (records.requiredModuleIds.length === 0) {
      throw new Error('No required security awareness training modules are defined');
    }

    const orgEvidence = {
      source: 'dilligent-employee-portal',
      portalTrainingEnabled: records.portalTrainingEnabled,
      requiredModules: records.requiredModuleIds,
      participantCount: records.participants.length,
      checkedAt: now.toISOString(),
    };

    if (!records.portalTrainingEnabled) {
      ctx.fail({
        title: 'Security training is turned off in the employee portal',
        description:
          'Employees are not shown the security awareness training, so new or expired training cannot be completed.',
        resourceType: 'organization',
        resourceId: 'portal-security-training',
        severity: 'medium',
        remediation:
          'Turn on "Show Security Training Step" under Settings > Portal, then ask employees to complete it.',
        evidence: orgEvidence,
      });
    }

    if (records.participants.length === 0) {
      // Passing on an empty roster would green the task on no evidence.
      ctx.fail({
        title: 'No people required to take security awareness training',
        description:
          'Nobody active in this organization has a compliance obligation, so training completion cannot be evidenced for anyone.',
        resourceType: 'organization',
        resourceId: 'training-roster',
        severity: 'medium',
        remediation:
          'Add your employees under People, and check their roles carry the compliance obligation, then re-run the check.',
        evidence: orgEvidence,
      });
      return;
    }

    let complete = 0;
    for (const participant of records.participants) {
      if (
        judgeParticipant(ctx, { participant, requiredModuleIds: records.requiredModuleIds, now })
      ) {
        complete++;
      }
    }

    ctx.log(
      `Security awareness training: ${complete}/${records.participants.length} people complete`,
    );
  },
};
