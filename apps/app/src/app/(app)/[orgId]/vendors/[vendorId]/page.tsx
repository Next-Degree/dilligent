import { serverApi } from '@/lib/api-server';
import { PageLayout } from '@trycompai/design-system';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { VendorDetailTabs } from './components/VendorDetailTabs';
import { splitVendorPeople, type OrgPerson } from './lib/org-people';

interface PageProps {
  params: Promise<{ vendorId: string; locale: string; orgId: string }>;
  searchParams?: Promise<{
    taskItemId?: string;
  }>;
}

interface PeopleApiResponse {
  data: OrgPerson[];
}

/**
 * Vendor detail page - server component
 * Fetches initial data server-side for fast first render
 * Passes data to VendorDetailTabs which handles both Overview and Risk Assessment tabs
 */
export default async function VendorPage({ params, searchParams }: PageProps) {
  const { vendorId, orgId } = await params;
  const { taskItemId } = (await searchParams) ?? {};

  // Fetch data in parallel for faster loading
  // GET /v1/vendors/:id returns vendor fields flat (no data wrapper)
  // GET /v1/people returns { data: people[], count }
  const [vendorResult, peopleResult] = await Promise.all([
    serverApi.get<Record<string, unknown>>(`/v1/vendors/${vendorId}`),
    serverApi.get<PeopleApiResponse>('/v1/people'),
  ]);

  const vendor = vendorResult.data;

  if (!vendor) {
    redirect('/');
  }

  // Split people into the two distinct person-pickers the vendor form uses
  // (Assignee: can edit vendors; System Owner: any active org member).
  const people = peopleResult.data?.data ?? [];
  const { assignees, owners } = splitVendorPeople(people, { orgId });

  // Hide vendor-level content when viewing a task in focus mode
  const isViewingTask = Boolean(taskItemId);

  return (
    <PageLayout>
      <VendorDetailTabs
        vendorId={vendorId}
        orgId={orgId}
        vendor={vendor as any}
        assignees={assignees as any}
        owners={owners as any}
        isViewingTask={isViewingTask}
      />
    </PageLayout>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Vendors',
  };
}
