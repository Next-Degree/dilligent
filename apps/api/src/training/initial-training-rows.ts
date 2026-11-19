import { db } from '@db';
import {
  requiredTrainingGroups,
  trainingFrameworkInstancesWhere,
} from '@trycompai/company';

/**
 * Create a new member's pending first cycle rows for every training they will
 * be asked to take.
 *
 * General training rows are created whatever the org's security training
 * setting, as they always have been, so switching the setting on later needs
 * no backfill. Framework gated training (HIPAA, CCPA) is added only for orgs
 * with that framework, from the shared catalog, so a new framework training
 * never needs another change here. Completion does not depend on these rows
 * existing; they only make the assignment visible from the start.
 */
export async function createInitialTrainingRows({
  memberId,
  organizationId,
}: {
  memberId: string;
  organizationId: string;
}): Promise<void> {
  const frameworkInstances = await db.frameworkInstance.findMany({
    where: trainingFrameworkInstancesWhere(organizationId),
    select: { framework: { select: { name: true } } },
  });

  const groups = requiredTrainingGroups({
    securityTrainingStepEnabled: true,
    // A custom framework instance has no framework record, so its name can be missing.
    frameworkNames: frameworkInstances.flatMap((instance) =>
      instance.framework ? [instance.framework.name] : [],
    ),
  });

  await db.employeeTrainingVideoCompletion.createMany({
    data: groups.flatMap((group) =>
      group.moduleIds.map((videoId) => ({ memberId, videoId })),
    ),
    skipDuplicates: true,
  });
}
