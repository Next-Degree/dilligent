'use client';

import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import { downloadPdfBlob } from './downloadPdfBlob';

/**
 * Fetch a member's training certificate from the API and save it in the
 * browser. The API checks the caller's training:read permission and that the
 * member belongs to the organization, so this calls it directly rather than
 * going through a server action.
 */
export async function downloadCertificate({
  path,
  organizationId,
  memberId,
  fileName,
}: {
  path: string;
  organizationId: string;
  memberId: string;
  fileName: string;
}): Promise<void> {
  try {
    const response = await apiClient.raw(path, {
      method: 'POST',
      organizationId,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    });

    if (!response.ok) {
      toast.error('Could not generate the training certificate.');
      return;
    }

    downloadPdfBlob({ blob: await response.blob(), fileName });
  } catch {
    toast.error('Could not generate the training certificate.');
  }
}
