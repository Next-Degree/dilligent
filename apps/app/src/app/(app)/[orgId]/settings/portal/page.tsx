import { serverApi } from '@/lib/api-server';
import { db } from '@db/server';
import type { Metadata } from 'next';
import type { PortalTaskRow } from './hooks/use-portal-tasks';
import { PortalSettings } from './portal-settings';
import { PortalTasksSection } from './portal-tasks-section';

export default async function PortalSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const [organization, portalTasksResponse] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: {
        deviceAgentStepEnabled: true,
        securityTrainingStepEnabled: true,
        whistleblowerReportEnabled: true,
        accessRequestFormEnabled: true,
      },
    }),
    // A reader without `task:read` gets an error here; the section then falls
    // back to its own fetch and renders the same empty state.
    serverApi.get<PortalTaskRow[]>('/v1/portal-tasks'),
  ]);

  const initialTasks = Array.isArray(portalTasksResponse.data)
    ? portalTasksResponse.data
    : undefined;

  return (
    <div className="space-y-8">
      <PortalSettings
        deviceAgentStepEnabled={organization?.deviceAgentStepEnabled ?? true}
        securityTrainingStepEnabled={organization?.securityTrainingStepEnabled ?? true}
        whistleblowerReportEnabled={organization?.whistleblowerReportEnabled ?? true}
        accessRequestFormEnabled={organization?.accessRequestFormEnabled ?? true}
      />
      <PortalTasksSection initialTasks={initialTasks} />
    </div>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Portal Settings',
  };
}
