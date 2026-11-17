import type { Device, Member, Organization, User } from '@db';
import { getRequiredTrainingGroups } from '@/lib/training/required-groups';
import { db } from '@db/server';
import { evidenceFormDefinitionList } from '@trycompai/company';
import { NoAccessMessage } from '../../components/NoAccessMessage';
import type { FleetPolicy, Host } from '../types';
import { EmployeeTasksList } from './EmployeeTasksList';
import { sortPoliciesByName } from './policy/sort-policies-by-name';

const portalForms = evidenceFormDefinitionList
  .filter((f) => f.portalAccessible)
  .map(({ type, title, description }) => ({ type, title, description }));

// Define the type for the member prop passed from Overview
interface MemberWithUserOrg extends Member {
  user: User;
  organization: Organization;
}

interface OrganizationDashboardProps {
  organizationId: string;
  member: MemberWithUserOrg;
  fleetPolicies: FleetPolicy[];
  host: Host | null;
  agentDevices: Device[];
}

export async function OrganizationDashboard({
  organizationId,
  member,
  fleetPolicies,
  host,
  agentDevices,
}: OrganizationDashboardProps) {
  // Fetch policies specific to the selected organization
  const policies = sortPoliciesByName(
    await db.policy.findMany({
      where: {
        organizationId: organizationId,
        isRequiredToSign: true,
        status: 'published',
        // Hide policies archived by the user or by a framework version sync.
        // A sync sets `archivedAt` but leaves `status: 'published'`, so both
        // flags must be checked. See packages/db Policy schema.
        isArchived: false,
        archivedAt: null,
      },
      include: {
        currentVersion: {
          select: {
            id: true,
            content: true,
            pdfUrl: true,
            version: true,
          },
        },
      },
    }),
  );

  // Fetch training video completions specific to the member
  const trainingVideos = await db.employeeTrainingVideoCompletion.findMany({
    where: {
      memberId: member.id,
    },
  });

  const [org, trainingGroups] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
    }),
    getRequiredTrainingGroups(organizationId),
  ]);

  if (!org) {
    return <NoAccessMessage />;
  }

  return (
    <EmployeeTasksList
      organizationId={organizationId}
      policies={policies}
      trainingVideos={trainingVideos}
      member={member}
      fleetPolicies={fleetPolicies}
      host={host}
      agentDevices={agentDevices}
      deviceAgentStepEnabled={org.deviceAgentStepEnabled}
      whistleblowerReportEnabled={org.whistleblowerReportEnabled}
      accessRequestFormEnabled={org.accessRequestFormEnabled}
      requiredGroupIds={trainingGroups.map((group) => group.id)}
      portalForms={portalForms}
    />
  );
}
