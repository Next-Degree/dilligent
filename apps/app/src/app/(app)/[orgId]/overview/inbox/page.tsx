import { INBOX_ENDPOINT, type InboxApiResponse, toInboxData } from '@/hooks/inbox-data';
import { serverApi } from '@/lib/api-server';
import { PageHeader, PageLayout } from '@trycompai/design-system';
import { OverviewTabs } from '../components/OverviewTabs';
import { InboxList } from './components/InboxList';

export function generateMetadata() {
  return { title: 'Inbox' };
}

export default async function Page({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;

  // On failure the client hook fetches (and surfaces the error) itself.
  const result = await serverApi.get<InboxApiResponse>(INBOX_ENDPOINT);
  const initialData = result.error ? undefined : toInboxData(result.data);

  return (
    <PageLayout header={<PageHeader title="Overview" tabs={<OverviewTabs />} />}>
      <InboxList orgId={orgId} initialData={initialData} />
    </PageLayout>
  );
}
