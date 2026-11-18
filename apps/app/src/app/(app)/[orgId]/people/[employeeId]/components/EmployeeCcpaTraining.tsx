'use client';

import { usePermissions } from '@/hooks/use-permissions';
import type { TrainingGroupView } from '@/lib/training/training-view';
import type { Organization } from '@db';
import { downloadCertificate } from './certificate-download';
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
  const { hasPermission } = usePermissions();
  // The API requires training:read to generate the certificate, so the button
  // is only offered to people who can actually use it.
  const canDownloadCertificate = hasPermission('training', 'read');

  const handleDownloadCertificate = () =>
    downloadCertificate({
      path: '/v1/training/generate-ccpa-certificate',
      organizationId: organization.id,
      memberId: employee.id,
      fileName: `ccpa-training-certificate-${safeEmployeeName(employee)}.pdf`,
    });

  return (
    <TrainingGroupPanel
      view={view}
      onDownloadCertificate={canDownloadCertificate ? handleDownloadCertificate : undefined}
    />
  );
}
