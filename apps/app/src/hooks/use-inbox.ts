'use client';

import { apiClient } from '@/lib/api-client';
import { useParams } from 'next/navigation';
import { useEffect } from 'react';
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
      // The badge mounts on every Overview tab; hopping between tabs should not
      // re-run the whole aggregation just to recount it.
      dedupingInterval: 60_000,
    },
  );

  // SWR prefers cached data over fallbackData, so a badge fetch from an earlier
  // page would otherwise mask this page's fresher server-rendered inbox.
  useEffect(() => {
    if (initialData) void mutate(initialData, { revalidate: false });
  }, [initialData, mutate]);

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
