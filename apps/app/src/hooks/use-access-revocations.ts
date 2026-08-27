'use client';

import { useApi } from '@/hooks/use-api';
import { useApiSWR } from '@/hooks/use-api-swr';
import { fileToBase64 } from '@/lib/file-utils';
import { useCallback } from 'react';

interface RevokedBy {
  id: string;
  name: string;
  email: string;
}

interface EvidenceFile {
  id: string;
  name: string;
  type: string;
  downloadUrl: string;
  createdAt: string;
}

/** Why a vendor is on this list — drives the provenance label in the UI. */
export type AccessProvenance = 'observed' | 'revoked-previously' | 'full-register';

export interface VendorRevocationItem {
  vendorId: string;
  vendorName: string;
  logoUrl: string | null;
  revoked: boolean;
  revokedAt: string | null;
  revokedBy: RevokedBy | null;
  notes: string | null;
  evidence: EvidenceFile[];
  provenance?: AccessProvenance;
}

interface AccessRevocationsResponse {
  vendors: VendorRevocationItem[];
  totalVendors: number;
  revokedCount: number;
  /**
   * False when the list is the whole vendor register because nothing has been observed.
   * The UI must say so rather than presenting an unscoped list as if it were tailored.
   */
  scopedToObservedAccess?: boolean;
}

export function useAccessRevocations(memberId: string) {
  const api = useApi();
  const endpoint = `/v1/offboarding-checklist/member/${memberId}/access-revocations`;

  const { data, error, isLoading, mutate } = useApiSWR<AccessRevocationsResponse>(endpoint);
  const revocations = data?.data ?? null;

  const revokeAccess = useCallback(
    async (vendorId: string, opts?: { notes?: string; file?: File }) => {
      let body: Record<string, unknown> = {};
      if (opts?.notes) body.notes = opts.notes;
      if (opts?.file) {
        const base64 = await fileToBase64(opts.file);
        body = { ...body, fileName: opts.file.name, fileType: opts.file.type || 'application/octet-stream', fileData: base64 };
      }
      const response = await api.post(`${endpoint}/${vendorId}`, body);
      if (response.error) throw new Error(response.error);
      await mutate();
    },
    [api, endpoint, mutate],
  );

  const undoRevocation = useCallback(
    async (vendorId: string) => {
      const response = await api.delete(`${endpoint}/${vendorId}`);
      if (response.error) throw new Error(response.error);
      await mutate();
    },
    [api, endpoint, mutate],
  );

  const revokeAll = useCallback(
    async () => {
      const response = await api.post(`${endpoint}/confirm-all`);
      if (response.error) throw new Error(response.error);
      await mutate();
    },
    [api, endpoint, mutate],
  );

  return {
    revocations,
    isLoading,
    error,
    revokeAccess,
    undoRevocation,
    revokeAll,
  };
}
