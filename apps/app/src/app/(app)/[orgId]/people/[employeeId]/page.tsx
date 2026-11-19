import { auth } from '@/utils/auth';

import { getFleetInstance } from '@/lib/fleet';
import { serverApi } from '@/lib/server-api-client';
import { getRequiredTrainingGroups } from '@/lib/training/required-groups';
import { buildTrainingGroupView } from '@/lib/training/training-view';
import type { Member, User } from '@db';
import { db } from '@db/server';
import { daysSinceCheckIn, getDeviceComplianceStatus } from '@trycompai/utils/devices';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { CheckDetails, DeviceWithChecks } from '../devices/types';
import type {
  BackgroundCheckBillingStatus,
  BackgroundCheckRecord,
} from './components/backgroundCheckTypes';
import { Employee } from './components/Employee';

const MDM_POLICY_ID = -9999;

export default async function EmployeeDetailsPage({
  params,
}: {
  params: Promise<{ employeeId: string; orgId: string }>;
}) {
  const { employeeId, orgId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const currentUserMember = await db.member.findFirst({
    where: {
      organizationId: orgId,
      userId: session?.user?.id,
    },
  });

  const canEditMembers =
    currentUserMember?.role.includes('owner') || currentUserMember?.role.includes('admin') || false;

  if (!orgId) {
    redirect('/');
  }

  const [
    policies,
    trainingGroups,
    trainingCompletions,
    employee,
    backgroundCheckRes,
    backgroundCheckBillingRes,
  ] = await Promise.all([
    getPoliciesTasks(employeeId),
    getRequiredTrainingGroups(orgId),
    db.employeeTrainingVideoCompletion.findMany({
      where: { memberId: employeeId, member: { organizationId: orgId } },
    }),
    getEmployee(employeeId),
    serverApi.get<BackgroundCheckRecord | null>(`/v1/people/${employeeId}/background-check`),
    serverApi.get<BackgroundCheckBillingStatus>('/v1/background-check-billing/status'),
  ]);

  // If employee doesn't exist, show 404 page
  if (!employee) {
    notFound();
  }

  const organization = await db.organization.findUnique({ where: { id: orgId } });

  if (!organization) {
    notFound();
  }

  // One view per training group this org requires, read from the member's
  // completions across all renewal cycles.
  const now = new Date();
  const trainingViews = trainingGroups.map((group) =>
    buildTrainingGroupView({ group, completions: trainingCompletions, now }),
  );

  const { fleetPolicies, device } = await getFleetPolicies(employee);
  const memberDevice = await getMemberDevice(employee.id, orgId);

  return (
    <Employee
      employee={employee}
      policies={policies}
      trainingViews={trainingViews}
      fleetPolicies={fleetPolicies}
      host={device}
      canEdit={canEditMembers}
      organization={organization}
      memberDevice={memberDevice}
      orgId={orgId}
      initialBackgroundCheck={backgroundCheckRes.data ?? null}
      initialBackgroundCheckBillingStatus={
        backgroundCheckBillingRes.data ?? {
          hasPaymentMethod: false,
          setupAt: null,
        }
      }
      backgroundCheckStepEnabled={organization.backgroundCheckStepEnabled === true}
      memberBackgroundCheckExempt={employee.backgroundCheckExempt === true}
    />
  );
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Employee Details',
  };
}

const getEmployee = async (employeeId: string) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const organizationId = session?.session.activeOrganizationId;

  if (!organizationId) {
    redirect('/');
  }

  const employee = await db.member.findFirst({
    where: {
      id: employeeId,
      organizationId,
    },
    include: {
      user: true,
    },
  });

  return employee;
};

const getPoliciesTasks = async (employeeId: string) => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  const organizationId = session?.session.activeOrganizationId;

  if (!organizationId) {
    redirect('/');
  }

  const policies = await db.policy.findMany({
    where: {
      organizationId: organizationId,
      status: 'published',
      isRequiredToSign: true,
      isArchived: false,
    },
    orderBy: {
      name: 'asc',
    },
  });

  return policies;
};

const getFleetPolicies = async (member: Member & { user: User }) => {
  const fleet = await getFleetInstance();

  // Only show device if the employee has their own specific fleetDmLabelId
  if (!member.fleetDmLabelId) {
    console.log(
      `No individual fleetDmLabelId found for member: ${member.id}, member email: ${member.user?.email}. No device will be shown.`,
    );
    return { fleetPolicies: [], device: null };
  }

  try {
    const deviceResponse = await fleet.get(`/labels/${member.fleetDmLabelId}/hosts`);
    const device = deviceResponse.data.hosts?.[0];

    if (!device) {
      console.log(
        `No device found for fleetDmLabelId: ${member.fleetDmLabelId} for member: ${member.id}`,
      );
      return { fleetPolicies: [], device: null };
    }

    const deviceWithPolicies = await fleet.get(`/hosts/${device.id}`);
    const host = deviceWithPolicies.data.host;

    const results = await db.fleetPolicyResult.findMany({
      where: {
        organizationId: member.organizationId,
        userId: member.userId,
      },
      orderBy: { createdAt: 'desc' },
    });

    const platform = host.platform?.toLowerCase();
    const osVersion = host.os_version?.toLowerCase();
    const isMacOS =
      platform === 'darwin' ||
      platform === 'macos' ||
      platform === 'osx' ||
      osVersion?.includes('mac');

    return {
      fleetPolicies: [
        ...(host.policies || []),
        ...(isMacOS
          ? [
              {
                id: MDM_POLICY_ID,
                name: 'MDM Enabled',
                response: host.mdm.connected_to_fleet ? 'pass' : 'fail',
              },
            ]
          : []),
      ].map((policy) => {
        const policyResult = results.find((result) => result.fleetPolicyId === policy.id);
        return {
          ...policy,
          response:
            policy.response === 'pass' || policyResult?.fleetPolicyResponse === 'pass'
              ? 'pass'
              : 'fail',
          attachments: policyResult?.attachments || [],
        };
      }),
      device: host,
    };
  } catch (error) {
    console.error(
      `Failed to get device using individual fleet label for member: ${member.id}`,
      error,
    );
    return { fleetPolicies: [], device: null };
  }
};

const getMemberDevice = async (
  memberId: string,
  organizationId: string,
): Promise<DeviceWithChecks | null> => {
  const devices = await db.device.findMany({
    where: { memberId, organizationId },
    include: {
      member: {
        include: {
          user: {
            select: { name: true, email: true },
          },
        },
      },
      agentSession: {
        select: { expiresAt: true },
      },
    },
    orderBy: { installedAt: 'desc' },
  });

  if (devices.length === 0) {
    return null;
  }

  // An agent device carries real compliance data; an integration import does
  // not. Prefer the richest source so the detail page never shows an imported
  // device as a failing agent device. Order of richness: agent > fleet > integration.
  const device =
    devices.find((d) => d.source === 'agent') ??
    devices.find((d) => d.source === 'fleet') ??
    devices[0];

  const source: DeviceWithChecks['source'] =
    device.source === 'integration'
      ? 'integration'
      : device.source === 'fleet'
        ? 'fleet'
        : 'device_agent';

  // Resolve the provider (name/slug) so an imported device shows its provenance
  // instead of being mislabeled as an agent device.
  let integrationProvider: DeviceWithChecks['integrationProvider'];
  if (source === 'integration' && device.integrationConnectionId) {
    const connection = await db.integrationConnection.findFirst({
      where: { id: device.integrationConnectionId, organizationId },
      select: { provider: { select: { slug: true, name: true } } },
    });
    if (connection?.provider) {
      integrationProvider = {
        slug: connection.provider.slug,
        name: connection.provider.name,
      };
    }
  }

  const complianceStatus = getDeviceComplianceStatus({
    isCompliant: device.isCompliant,
    lastCheckIn: device.lastCheckIn,
  });

  return {
    id: device.id,
    name: device.name,
    hostname: device.hostname,
    platform: device.platform as 'macos' | 'windows' | 'linux',
    osVersion: device.osVersion,
    serialNumber: device.serialNumber,
    hardwareModel: device.hardwareModel,
    isCompliant: device.isCompliant,
    diskEncryptionEnabled: device.diskEncryptionEnabled,
    antivirusEnabled: device.antivirusEnabled,
    passwordPolicySet: device.passwordPolicySet,
    screenLockEnabled: device.screenLockEnabled,
    checkDetails: (device.checkDetails as CheckDetails) ?? null,
    lastCheckIn: device.lastCheckIn?.toISOString() ?? null,
    agentVersion: device.agentVersion,
    installedAt: device.installedAt.toISOString(),
    memberId: device.memberId,
    user: {
      name: device.member.user.name,
      email: device.member.user.email,
    },
    source,
    ...(integrationProvider ? { integrationProvider } : {}),
    complianceStatus,
    daysSinceLastCheckIn: daysSinceCheckIn(device.lastCheckIn),
    hasActiveAgentSession:
      source === 'device_agent' &&
      !!device.agentSession &&
      device.agentSession.expiresAt.getTime() > Date.now(),
  };
};
