'use client';

import { apiClient } from '@/lib/api-client';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { INBOX_ENDPOINT, type InboxApiResponse, type InboxData, toInboxData } from './inbox-data';

export function useInbox({ initialData }: { initialData?: InboxData } = {}) {
  const params = useParams<{ orgId?: string }>();
  const orgId = params?.orgId;

  const { data, error, isLoading, mutate } = useSWR<InboxData | undefined>(
    orgId ? ['inbox', orgId] : null,
    async () => {
      const response = await apiClient.get<InboxApiResponse>(INBOX_ENDPOINT);
      if (response.error) throw new Error(response.error);
      return toInboxData(response.data);
    },
    {
      fallbackData: initialData,
      revalidateOnMount: !initialData,
      revalidateOnFocus: false,
    },
  );

  return {
    // Guards a stale cache entry from a previous shape.
    items: Array.isArray(data?.items) ? data.items : [],
    totals: data?.totals ?? {},
    unavailable: Array.isArray(data?.unavailable) ? data.unavailable : [],
    hasData: data !== undefined,
    isLoading,
    error,
    refresh: mutate,
  };
}
