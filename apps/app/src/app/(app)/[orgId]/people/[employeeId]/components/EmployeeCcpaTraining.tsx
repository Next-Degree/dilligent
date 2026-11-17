'use client';

import { apiClient } from '@/lib/api-client';
import type { TrainingGroupView } from '@/lib/training/training-view';
import type { Organization } from '@db';
import { toast } from 'sonner';
import { downloadPdfBlob } from './downloadBase64Pdf';
import { TrainingGroupPanel, safeEmployeeName, type EmployeeWithUser } from './TrainingGroupPanel';

interface EmployeeCcpaTrainingProps {
  employee: EmployeeWithUser;
  organization: Organization;
  view: TrainingGroupView;
}

/**
 * A member's CCPA Privacy Training: progress through the two videos, and the
 * completion certificate once both are done.
 *
 * The certificate comes straight from the API as a PDF (the API checks the
 * caller's training:read permission and that the member belongs to the org),
 * rather than through a server action.
 */
export function EmployeeCcpaTraining({ employee, organization, view }: EmployeeCcpaTrainingProps) {
  const handleDownloadCertificate = async () => {
    const response = await apiClient.raw('/v1/training/generate-ccpa-certificate', {
      method: 'POST',
      organizationId: organization.id,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: employee.id }),
    });

    if (!response.ok) {
      toast.error('Could not generate the CCPA training certificate.');
      return;
    }

    downloadPdfBlob(
      await response.blob(),
      `ccpa-training-certificate-${safeEmployeeName(employee)}.pdf`,
    );
  };

  return <TrainingGroupPanel view={view} onDownloadCertificate={handleDownloadCertificate} />;
}
