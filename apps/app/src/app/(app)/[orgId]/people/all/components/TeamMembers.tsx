import { filterComplianceMembers } from '@/lib/compliance';
import { serverApi } from '@/lib/server-api-client';
import { getRequiredTrainingGroups } from '@/lib/training/required-groups';
import type { Invitation, Member, User } from '@db';
import { db } from '@db/server';
import type { TrainingGroupId } from '@trycompai/company';
import { getEmployeeSyncConnections } from '../data/queries';
import { buildTaskCompletionMap } from './task-completion';
import { TeamMembersClient } from './TeamMembersClient';
import type { BackgroundCheckStatus } from '../../[employeeId]/components/backgroundCheckTypes';
import {
  buildTwoFactorStatusMap,
  type TwoFactorStatusesResponse,
} from './two-factor-status-map';

export type { BackgroundCheckStatus };
export type { TwoFactorStatus } from './two-factor-status-map';

export interface MemberWithUser extends Member {
  user: User;
  backgroundCheckRequests?: BackgroundCheckSummary[];
}

export interface BackgroundCheckSummary {
  id: string;
  status: BackgroundCheckStatus;
}

export interface TeamMembersData {
  members: MemberWithUser[];
  pendingInvitations: Invitation[];
}

export type { TaskCompletion } from './task-completion';

export type DeviceStatus = 'compliant' | 'non-compliant' | 'not-installed';

export interface TeamMembersProps {
  canManageMembers: boolean;
  canInviteUsers: boolean;
  isCurrentUserOwner: boolean;
  organizationId: string;
}

export async function TeamMembers(props: TeamMembersProps) {
  const {
    canManageMembers,
    canInviteUsers,
    isCurrentUserOwner,
    organizationId,
  } = props;

  if (!organizationId) {
    return null;
  }

  // Fetch members, invitations, and 2FA statuses from API
  const [membersRes, invitationsRes, twoFactorRes] = await Promise.all([
    serverApi.get<{ data: MemberWithUser[]; count: number }>(
      '/v1/people?includeDeactivated=true',
    ),
    serverApi.get<{ data: Invitation[] }>('/v1/auth/invitations'),
    serverApi.get<TwoFactorStatusesResponse>(
      '/v1/integrations/sync/two-factor-statuses',
    ),
  ]);

  const members: MemberWithUser[] = Array.isArray(membersRes.data?.data)
    ? membersRes.data.data
    : [];
  const pendingInvitations: Invitation[] = Array.isArray(invitationsRes.data?.data)
    ? invitationsRes.data.data
    : [];

  const data: TeamMembersData = { members, pendingInvitations };

  // Empty when no 2FA source is configured (or the fetch failed) — rows then
  // show no 2FA entry rather than a wrong one.
  const twoFactorStatusMap = buildTwoFactorStatusMap(
    members,
    twoFactorRes.data ?? undefined,
  );

  // Fetch employee sync connections server-side
  const employeeSyncData = await getEmployeeSyncConnections(organizationId);

  const employeeMembers = await filterComplianceMembers(members, organizationId);
  const complianceMemberIds = employeeMembers.map((m) => m.id);

  const [orgFlags, trainingGroups, policies] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { backgroundCheckStepEnabled: true },
    }),
    getRequiredTrainingGroups(organizationId),
    db.policy.findMany({
      where: {
        organizationId,
        isRequiredToSign: true,
        status: 'published',
        isArchived: false,
      },
    }),
  ]);
  const backgroundCheckStepEnabled = orgFlags?.backgroundCheckStepEnabled === true;
  const requiresTraining = (id: TrainingGroupId) =>
    trainingGroups.some((group) => group.id === id);

  // Column visibility must come from ORG-LEVEL tracking, not from member data:
  // an org with tracking enabled but no compliance members yet still shows the
  // columns (as dashes), never silently hides them.
  const requirementTracking = {
    policies: policies.length > 0,
    training: requiresTraining('general'),
    hipaa: requiresTraining('hipaa'),
    ccpa: requiresTraining('ccpa'),
  };

  // Build task completion map for employees/contractors
  const trainingCompletions =
    employeeMembers.length > 0 && trainingGroups.length > 0
      ? await db.employeeTrainingVideoCompletion.findMany({
          where: { memberId: { in: employeeMembers.map((m) => m.id) } },
        })
      : [];
  const taskCompletionMap = buildTaskCompletionMap({
    employees: employeeMembers,
    policies,
    groups: trainingGroups,
    completions: trainingCompletions,
    now: new Date(),
  });

  return (
    <TeamMembersClient
      data={data}
      organizationId={organizationId}
      canManageMembers={canManageMembers}
      canInviteUsers={canInviteUsers}
      isCurrentUserOwner={isCurrentUserOwner}
      employeeSyncData={employeeSyncData}
      taskCompletionMap={taskCompletionMap}
      complianceMemberIds={complianceMemberIds}
      backgroundCheckStepEnabled={backgroundCheckStepEnabled}
      twoFactorStatusMap={twoFactorStatusMap}
      requirementTracking={requirementTracking}
    />
  );
}
