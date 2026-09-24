'use client';

import { useOrganizationFindings } from '@/hooks/use-findings-api';
import { useInbox } from '@/hooks/use-inbox';
import { useFeatureFlag } from '@trycompai/analytics';
import { FindingStatus } from '@db';
import { TabsList, TabsTrigger, Tabs } from '@trycompai/design-system';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

const SUB_ROUTES = ['inbox', 'findings', 'timeline'] as const;

/**
 * Overview nav tabs. Renders link-based tabs so each sub-route (`/overview`,
 * `/overview/inbox`, `/overview/findings`, `/overview/timeline`) paints
 * without loading the other's data.
 */
export function OverviewTabs() {
  const { orgId } = useParams<{ orgId: string }>();
  const pathname = usePathname();
  const isTimelineEnabled = useFeatureFlag('is-timeline-enabled');

  const activeValue =
    SUB_ROUTES.find((route) => pathname?.endsWith(`/${route}`)) ?? 'overview';

  // Lightweight count for the tab badge — filters to status=open on the server.
  const { data: openFindingsData } = useOrganizationFindings({
    status: FindingStatus.open,
  });
  const openCount = Array.isArray(openFindingsData?.data)
    ? openFindingsData.data.length
    : 0;

  // Shares the Inbox page's SWR key, so the badge and the list stay in sync.
  const { totals: inboxTotals } = useInbox();
  const inboxCount = Object.values(inboxTotals).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  );

  const overviewHref = `/${orgId}/overview`;
  const inboxHref = `/${orgId}/overview/inbox`;
  const findingsHref = `/${orgId}/overview/findings`;
  const timelineHref = `/${orgId}/overview/timeline`;

  return (
    <Tabs value={activeValue}>
      <TabsList variant="underline">
        <TabsTrigger
          value="overview"
          nativeButton={false}
          render={<Link href={overviewHref} prefetch />}
        >
          Overview
        </TabsTrigger>
        <TabsTrigger
          value="inbox"
          nativeButton={false}
          render={<Link href={inboxHref} prefetch />}
        >
          Inbox{inboxCount > 0 ? ` (${inboxCount})` : ''}
        </TabsTrigger>
        <TabsTrigger
          value="findings"
          nativeButton={false}
          render={<Link href={findingsHref} prefetch />}
        >
          Findings{openCount > 0 ? ` (${openCount})` : ''}
        </TabsTrigger>
        {isTimelineEnabled && (
          <TabsTrigger
            value="timeline"
            nativeButton={false}
            render={<Link href={timelineHref} prefetch />}
          >
            Timeline
          </TabsTrigger>
        )}
      </TabsList>
    </Tabs>
  );
}
