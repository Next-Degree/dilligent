import { filterComplianceMembers } from '@/lib/compliance';
import { getRequiredTrainingGroups } from '@/lib/training/required-groups';
import { db } from '@db/server';
import {
  assessRequiredTraining,
  groupCompletionsByMember,
  hasCompletedRequiredTraining,
} from '@trycompai/company';

export async function getPeopleScore(organizationId: string) {
  // Get all active members (employees and contractors); exclude inactive/deactivated
  const allMembers = await db.member.findMany({
    where: {
      organizationId,
      isActive: true,
      deactivated: false,
    },
    include: {
      user: true,
    },
  });

  // Filter to members with the compliance obligation
  const employees = await filterComplianceMembers(allMembers, organizationId);

  if (employees.length === 0) {
    return {
      totalMembers: 0,
      completedMembers: 0,
    };
  }

  // Get all required policies (published, required to sign, not archived)
  const requiredPolicies = await db.policy.findMany({
    where: {
      organizationId,
      isRequiredToSign: true,
      status: 'published',
      isArchived: false,
    },
  });

  // The training groups this org requires (general, plus HIPAA / CCPA when the
  // org has those frameworks). Completions are only read when something is
  // required, same as the People page.
  const trainingGroups = await getRequiredTrainingGroups(organizationId);
  const trainingCompletions =
    trainingGroups.length > 0
      ? await db.employeeTrainingVideoCompletion.findMany({
          where: {
            memberId: {
              in: employees.map((e) => e.id),
            },
          },
        })
      : [];
  const completionsByMember = groupCompletionsByMember(trainingCompletions);
  const now = new Date();

  // Get fleet instance for device checks
  // const fleet = await getFleetInstance();

  // Check each employee's completion status
  let completedMembers = 0;

  for (const employee of employees) {
    // 1. Check if all policies are accepted
    const hasAcceptedAllPolicies =
      requiredPolicies.length === 0 ||
      requiredPolicies.every((policy) => policy.signedBy.includes(employee.id));

    // 2. Check every required training group: valid, or valid and due for
    // renewal, counts; an expired or unfinished group does not.
    const hasCompletedTraining = hasCompletedRequiredTraining(
      assessRequiredTraining({
        groups: trainingGroups,
        completions: completionsByMember.get(employee.id) ?? [],
        now,
      }),
    );

    // 3. Check if device is secure
    // let hasSecureDevice = false;

    /*  if (employee.fleetDmLabelId) {
      try {
        const deviceResponse = await fleet.get(`/labels/${employee.fleetDmLabelId}/hosts`);
        const device = deviceResponse.data.hosts?.[0];

        if (device) {
          const deviceWithPolicies = await fleet.get(`/hosts/${device.id}`);
          const fleetPolicies = deviceWithPolicies.data.host.policies || [];
          hasSecureDevice = fleetPolicies.every(
            (policy: { response: string }) => policy.response === 'pass',
          );
        }
      } catch (error) {
        // If there's an error fetching device, consider it not secure
        hasSecureDevice = false;
      }
    } */

    if (hasAcceptedAllPolicies && hasCompletedTraining) {
      completedMembers++;
    }
  }

  return {
    totalMembers: employees.length,
    completedMembers,
  };
}
