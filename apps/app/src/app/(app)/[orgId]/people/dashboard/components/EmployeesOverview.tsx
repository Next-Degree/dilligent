import { filterComplianceMembers } from '@/lib/compliance';
import { getRequiredTrainingGroups } from '@/lib/training/required-groups';
import { auth } from '@/utils/auth';
import type { EmployeeTrainingVideoCompletion, Member, Policy, User } from '@db';
import { db } from '@db/server';
import type { TrainingGroupId } from '@trycompai/company';
import { headers } from 'next/headers';
import { EmployeeCompletionChart } from './EmployeeCompletionChart';

// Define EmployeeWithUser type similar to EmployeesList
interface EmployeeWithUser extends Member {
  user: User;
}

export async function EmployeesOverview() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const organizationId = session?.session.activeOrganizationId;

  let employees: EmployeeWithUser[] = [];
  let policies: Policy[] = [];
  let trainingCompletions: EmployeeTrainingVideoCompletion[] = [];
  let requiredGroupIds: TrainingGroupId[] = [];

  if (organizationId) {
    // Fetch employees
    const fetchedMembers = await db.member.findMany({
      where: {
        organizationId: organizationId,
        deactivated: false,
        isActive: true,
      },
      include: {
        user: true,
      },
    });

    employees = await filterComplianceMembers(fetchedMembers, organizationId);

    // Fetch required policies that are published and not archived
    policies = await db.policy.findMany({
      where: {
        organizationId: organizationId,
        isRequiredToSign: true,
        status: 'published',
        isArchived: false,
      },
    });

    // The training groups this org requires (general, plus HIPAA / CCPA when the
    // org has those frameworks). The chart works out each employee's progress
    // from their completion rows across all renewal cycles.
    const trainingGroups = await getRequiredTrainingGroups(organizationId);
    requiredGroupIds = trainingGroups.map((group) => group.id);

    if (employees.length > 0 && trainingGroups.length > 0) {
      trainingCompletions = await db.employeeTrainingVideoCompletion.findMany({
        where: {
          memberId: {
            in: employees.map((employee) => employee.id),
          },
        },
      });
    }
  }

  return (
    <div className="grid gap-6">
      <EmployeeCompletionChart
        employees={employees}
        policies={policies}
        trainingCompletions={trainingCompletions}
        requiredGroupIds={requiredGroupIds}
        showAll={true}
      />
    </div>
  );
}
