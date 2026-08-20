import { serverApi } from '@/lib/api-server';
import type { DiscoveredVendor } from '@/hooks/use-discovered-vendors';
import { PageHeader, PageLayout } from '@trycompai/design-system';
import { DiscoveredVendorsTable } from './components/DiscoveredVendorsTable';
import { VendorsTabs } from '../components/VendorsTabs';

interface DiscoveredVendorsApiResponse {
  data: DiscoveredVendor[];
  count: number;
}

export default async function Page({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const result = await serverApi.get<DiscoveredVendorsApiResponse>(
    '/v1/vendors/discovered?status=pending',
  );
  const discovered = result.data?.data ?? [];

  return (
    <PageLayout header={<PageHeader title="Vendors" />}>
      <VendorsTabs orgId={orgId} pendingCount={discovered.length} />
      <DiscoveredVendorsTable initialData={discovered} status="pending" />
    </PageLayout>
  );
}
