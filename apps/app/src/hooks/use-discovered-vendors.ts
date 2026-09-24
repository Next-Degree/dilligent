'use client';

import { apiClient } from '@/lib/api-client';
import { useCallback, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';
import { useParams } from 'next/navigation';

export type DiscoveredVendorStatus = 'pending' | 'approved' | 'ignored';

export interface DiscoveredVendorGrantee {
  id: string;
  scopes: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  member: {
    id: string;
    user: { name: string | null; email: string } | null;
  };
}

export interface DiscoveredVendor {
  id: string;
  externalAppId: string;
  displayName: string | null;
  status: DiscoveredVendorStatus;
  ignoredReason: string | null;
  granteeCount: number;
  scopes: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  disappearedAt: string | null;
  resolutionMethod: string;
  resolvedName: string | null;
  resolvedWebsite: string | null;
  resolvedDescription: string | null;
  confidence: number | null;
  vendorId: string | null;
  vendor: { id: string; name: string } | null;
  grants?: DiscoveredVendorGrantee[];
}

interface ListResponse {
  data: DiscoveredVendor[];
  count: number;
}

const LIST_KEY = '/v1/vendors/discovered';

export function useDiscoveredVendors({
  status,
  initialData,
}: {
  status?: DiscoveredVendorStatus;
  initialData?: DiscoveredVendor[];
} = {}) {
  const params = useParams<{ orgId?: string }>();
  const orgId = params?.orgId;

  const endpoint = status ? `${LIST_KEY}?status=${status}` : LIST_KEY;

  const { data, error, isLoading, mutate } = useSWR<DiscoveredVendor[]>(
    orgId ? ['discovered-vendors', orgId, status ?? 'all'] : null,
    async () => {
      const response = await apiClient.get<ListResponse>(endpoint);
      if (response.error) throw new Error(response.error);
      return response.data?.data ?? [];
    },
    {
      fallbackData: initialData,
      revalidateOnMount: !initialData,
      revalidateOnFocus: false,
    },
  );

  return {
    // Guards a stale cache entry from a previous shape.
    discoveredVendors: Array.isArray(data) ? data : [],
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useDiscoveredVendor(candidateId: string | null) {
  const params = useParams<{ orgId?: string }>();
  const orgId = params?.orgId;

  const { data, error, isLoading, mutate } = useSWR<DiscoveredVendor | null>(
    orgId && candidateId ? ['discovered-vendor', orgId, candidateId] : null,
    async () => {
      const response = await apiClient.get<DiscoveredVendor>(
        `${LIST_KEY}/${candidateId}`,
      );
      if (response.error) throw new Error(response.error);
      return response.data ?? null;
    },
    { revalidateOnFocus: false },
  );

  return { discoveredVendor: data ?? null, isLoading, error, refresh: mutate };
}

export interface ApproveDiscoveredVendorInput {
  name?: string;
  website?: string;
  description?: string;
  category?: string;
}

/**
 * Mutations for the review queue.
 *
 * Approval revalidates the vendor list as well as the queue: it creates a vendor, and
 * leaving the vendors table stale would make the approval look like it did nothing.
 */
export function useDiscoveredVendorActions() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const revalidate = useCallback(async () => {
    await globalMutate(
      (key) =>
        Array.isArray(key) &&
        (key[0] === 'discovered-vendors' ||
          key[0] === 'discovered-vendor' ||
          key[0] === 'vendors'),
      undefined,
      { revalidate: true },
    );
  }, []);

  const run = useCallback(
    async <T,>(request: () => Promise<{ data?: T; error?: string }>): Promise<T> => {
      setIsSubmitting(true);
      try {
        const response = await request();
        if (response.error) throw new Error(response.error);
        await revalidate();
        return response.data as T;
      } finally {
        setIsSubmitting(false);
      }
    },
    [revalidate],
  );

  const approve = useCallback(
    (candidateId: string, input: ApproveDiscoveredVendorInput = {}) =>
      run(() => apiClient.post(`${LIST_KEY}/${candidateId}/approve`, input)),
    [run],
  );

  const ignore = useCallback(
    (candidateId: string, reason?: string) =>
      run(() => apiClient.post(`${LIST_KEY}/${candidateId}/ignore`, { reason })),
    [run],
  );

  const reopen = useCallback(
    (candidateId: string) =>
      run(() => apiClient.post(`${LIST_KEY}/${candidateId}/reopen`, {})),
    [run],
  );

  const rescan = useCallback(
    (connectionId: string) =>
      run(() => apiClient.post(`${LIST_KEY}/rescan`, { connectionId })),
    [run],
  );

  return { approve, ignore, reopen, rescan, isSubmitting };
}
