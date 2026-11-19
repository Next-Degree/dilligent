import { db } from '@db/server';
import {
  requiredTrainingGroups,
  trainingFrameworkInstancesWhere,
  type TrainingGroup,
} from '@trycompai/company';

/**
 * The training groups an organization's members must take: general training
 * when the org switched security training on, plus one per framework that
 * brings its own (HIPAA, CCPA).
 *
 * One framework query covers every gating framework, so adding a training
 * framework never adds a lookup to the pages that call this.
 */
export async function getRequiredTrainingGroups(organizationId: string): Promise<TrainingGroup[]> {
  const [organization, frameworkInstances] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { securityTrainingStepEnabled: true },
    }),
    db.frameworkInstance.findMany({
      where: trainingFrameworkInstancesWhere(organizationId),
      select: { framework: { select: { name: true } } },
    }),
  ]);

  return requiredTrainingGroups({
    securityTrainingStepEnabled: organization?.securityTrainingStepEnabled === true,
    // A custom framework instance has no framework record, so its name can be missing.
    frameworkNames: frameworkInstances.flatMap((instance) =>
      instance.framework ? [instance.framework.name] : [],
    ),
  });
}
