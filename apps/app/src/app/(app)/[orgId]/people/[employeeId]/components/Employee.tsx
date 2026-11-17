'use client';

import type { TrainingGroupView } from '@/lib/training/training-view';
import type { Member, Organization, Policy, User } from '@db';
import {
  PageLayout,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@trycompai/design-system';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';
import type { DeviceWithChecks, FleetPolicy, Host } from '../../devices/types';
import type { BackgroundCheckBillingStatus, BackgroundCheckRecord } from './backgroundCheckTypes';
import { EmployeeBackgroundCheck } from './EmployeeBackgroundCheck';
import { EmployeeDetails } from './EmployeeDetails';
import { EmployeeDevice } from './EmployeeDevice';
import { EmployeePageHeader } from './EmployeePageHeader';
import { EmployeeVendorAccess } from './EmployeeVendorAccess';
import { EmployeeAccess } from './EmployeeAccess';
import { EmployeeLinkedAccount } from './EmployeeLinkedAccount';
import { EmployeePolicies } from './EmployeePolicies';
import {
  EmployeeCcpaTraining,
  EmployeeHipaaTraining,
  EmployeeTrainingVideos,
} from './EmployeeTraining';
import { isAuditorOnly } from './isAuditorOnly';
import { OffboardingChecklist } from './OffboardingChecklist';

type EmployeeTab =
  | 'details'
  | 'policies'
  | 'training'
  | 'hipaa'
  | 'ccpa'
  | 'device'
  | 'access'
  | 'offboarding'
  | 'background-check';

interface EmployeeProps {
  employee: Member & {
    user: User;
  };
  policies: Policy[];
  /** One view per training group the org requires. */
  trainingViews: TrainingGroupView[];
  fleetPolicies: FleetPolicy[];
  host: Host;
  canEdit: boolean;
  organization: Organization;
  memberDevice: DeviceWithChecks | null;
  orgId: string;
  initialBackgroundCheck: BackgroundCheckRecord | null;
  initialBackgroundCheckBillingStatus: BackgroundCheckBillingStatus;
  backgroundCheckStepEnabled: boolean;
  memberBackgroundCheckExempt: boolean;
}

export function Employee({
  employee,
  policies,
  trainingViews,
  fleetPolicies,
  host,
  canEdit,
  organization,
  memberDevice,
  orgId,
  initialBackgroundCheck,
  initialBackgroundCheckBillingStatus,
  backgroundCheckStepEnabled,
  memberBackgroundCheckExempt,
}: EmployeeProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const generalView = trainingViews.find((view) => view.group.id === 'general');
  const hipaaView = trainingViews.find((view) => view.group.id === 'hipaa');
  const ccpaView = trainingViews.find((view) => view.group.id === 'ccpa');

  // CS-416: auditor-only members aren't subject to background checks, so the
  // tab, header status, and content are hidden for them.
  const showBackgroundCheck = backgroundCheckStepEnabled && !isAuditorOnly(employee.role);

  const availableTabs: EmployeeTab[] = [
    'details',
    'policies',
    'training',
    ...(hipaaView ? (['hipaa'] as EmployeeTab[]) : []),
    ...(ccpaView ? (['ccpa'] as EmployeeTab[]) : []),
    'device',
    'access',
    ...(showBackgroundCheck ? (['background-check'] as EmployeeTab[]) : []),
    ...(employee.offboardDate ? (['offboarding'] as EmployeeTab[]) : []),
  ];

  const resolveTab = (): EmployeeTab => {
    if (
      showBackgroundCheck &&
      (searchParams.get('background_check_step') || searchParams.get('background_check_billing'))
    ) {
      return 'background-check';
    }
    const tabParam = searchParams.get('tab');
    if (tabParam && availableTabs.includes(tabParam as EmployeeTab)) {
      return tabParam as EmployeeTab;
    }
    return 'details';
  };

  const activeTab = resolveTab();

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'details') {
        params.delete('tab');
      } else {
        params.set('tab', value);
      }
      params.delete('background_check_step');
      params.delete('background_check_billing');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const [memberExempt, setMemberExempt] = useState(memberBackgroundCheckExempt);
  const [lastSyncedExempt, setLastSyncedExempt] = useState(memberBackgroundCheckExempt);

  if (memberBackgroundCheckExempt !== lastSyncedExempt) {
    setLastSyncedExempt(memberBackgroundCheckExempt);
    setMemberExempt(memberBackgroundCheckExempt);
  }

  return (
    <PageLayout
      header={
        <EmployeePageHeader
          employeeName={employee.user.name ?? 'Employee'}
          orgId={orgId}
          backgroundCheck={initialBackgroundCheck}
          backgroundCheckStepEnabled={showBackgroundCheck}
          memberBackgroundCheckExempt={memberExempt}
        />
      }
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value) handleTabChange(value);
        }}
      >
        <Stack gap="4">
          <TabsList variant="underline">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="policies">Policies</TabsTrigger>
            <TabsTrigger value="training">Training Videos</TabsTrigger>
            {hipaaView && <TabsTrigger value="hipaa">HIPAA Training</TabsTrigger>}
            {ccpaView && <TabsTrigger value="ccpa">CCPA Training</TabsTrigger>}
            <TabsTrigger value="device">Device</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            {showBackgroundCheck && (
              <TabsTrigger value="background-check">Background Check</TabsTrigger>
            )}
            {employee.offboardDate && <TabsTrigger value="offboarding">Offboarding</TabsTrigger>}
          </TabsList>
          <TabsContent value="details">
            <EmployeeDetails employee={employee} canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="policies">
            <EmployeePolicies employee={employee} policies={policies} />
          </TabsContent>
          <TabsContent value="training">
            <EmployeeTrainingVideos
              employee={employee}
              view={generalView}
              organization={organization}
            />
          </TabsContent>
          {hipaaView && (
            <TabsContent value="hipaa">
              <EmployeeHipaaTraining
                employee={employee}
                organization={organization}
                view={hipaaView}
              />
            </TabsContent>
          )}
          {ccpaView && (
            <TabsContent value="ccpa">
              <EmployeeCcpaTraining employee={employee} view={ccpaView} />
            </TabsContent>
          )}
          <TabsContent value="access">
            <Stack gap="md">
              <EmployeeLinkedAccount
                memberId={employee.id}
                externalUserSource={employee.externalUserSource}
                externalUserId={employee.externalUserId}
                canEdit={canEdit}
              />
              <EmployeeAccess memberId={employee.id} organizationId={orgId} />
              <EmployeeVendorAccess memberId={employee.id} />
            </Stack>
          </TabsContent>
          <TabsContent value="device">
            <EmployeeDevice
              organization={organization}
              memberDevice={memberDevice}
              host={host}
              fleetPolicies={fleetPolicies}
            />
          </TabsContent>
          {employee.offboardDate && (
            <TabsContent value="offboarding">
              <OffboardingChecklist
                memberId={employee.id}
                canEdit={canEdit}
                offboardDate={employee.offboardDate?.toISOString() ?? ''}
              />
            </TabsContent>
          )}
          {showBackgroundCheck && (
            <TabsContent value="background-check">
              <EmployeeBackgroundCheck
                employee={employee}
                organizationId={orgId}
                initialBackgroundCheck={initialBackgroundCheck}
                initialBillingStatus={initialBackgroundCheckBillingStatus}
                backgroundCheckStepEnabled={backgroundCheckStepEnabled}
                memberBackgroundCheckExempt={memberExempt}
                onMemberBackgroundCheckExemptChange={setMemberExempt}
              />
            </TabsContent>
          )}
        </Stack>
      </Tabs>
    </PageLayout>
  );
}
