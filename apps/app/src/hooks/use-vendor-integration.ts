'use client';

import { useApiSWR, type UseApiSWROptions } from '@/hooks/use-api-swr';
import { useMemo } from 'react';

/** How a vendor was identified as an integration (strongest first). */
export type VendorIntegrationMatchReason = 'slug' | 'name' | 'alias' | 'domain';

export interface VendorIntegrationLink {
  slug: string;
  name: string;
  logoUrl: string | null;
  connected: boolean;
  connectionId: string | null;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  category: string;
  matchedOn: VendorIntegrationMatchReason;
}

export interface VendorIntegrationLinkForVendor extends VendorIntegrationLink {
  vendorId: string;
}

export interface VendorIntegrationCheckRun {
  runId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  totalChecked: number;
  passedCount: number;
  failedCount: number;
  errorMessage: string | null;
}

export interface VendorIntegrationCheck {
  checkId: string;
  name: string;
  description: string;
  taskMapping: string | null;
  lastRun: VendorIntegrationCheckRun | null;
}

export interface VendorIntegrationUser {
  resourceId: string;
  email: string | null;
  name: string | null;
  role: string | null;
  isAdmin: boolean | null;
  status: string | null;
  lastLogin: string | null;
  passed: boolean;
  checks: { checkId: string; checkName: string }[];
  collectedAt: string;
  member: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    deactivated: boolean;
  } | null;
}

interface VendorIntegrationResponse {
  vendorId: string;
  integration: VendorIntegrationLink | null;
  checks: VendorIntegrationCheck[];
  users: VendorIntegrationUser[];
}

interface VendorIntegrationLinksResponse {
  data: VendorIntegrationLinkForVendor[];
  count: number;
}

/**
 * The integration linked to one vendor, with its checks and the people those
 * checks report. `integration` is null when nothing in the catalog matches the
 * vendor; `checks`/`users` are empty until the integration is connected.
 */
export function useVendorIntegration(
  vendorId: string | null,
  options: UseApiSWROptions<VendorIntegrationResponse> = {},
) {
  const swr = useApiSWR<VendorIntegrationResponse>(
    vendorId ? `/v1/vendor-integrations/${vendorId}` : null,
    options,
  );

  return {
    ...swr,
    integration: swr.data?.data?.integration ?? null,
    checks: swr.data?.data?.checks ?? [],
    users: swr.data?.data?.users ?? [],
  };
}

/**
 * Integration links for every vendor in the org, keyed by vendor id — for list
 * views that show which vendors are covered by a connected integration.
 */
export function useVendorIntegrationLinks(
  options: UseApiSWROptions<VendorIntegrationLinksResponse> = {},
) {
  const swr = useApiSWR<VendorIntegrationLinksResponse>(
    '/v1/vendor-integrations',
    options,
  );

  const links = swr.data?.data?.data;
  const linksByVendorId = useMemo(
    () =>
      new Map(
        (Array.isArray(links) ? links : []).map((link) => [link.vendorId, link]),
      ),
    [links],
  );

  return { ...swr, linksByVendorId };
}
