'use client';

import type { TrainingGroupView } from '@/lib/training/training-view';
import { cn } from '@/lib/utils';
import type { Organization } from '@db';
import { Button, Text } from '@trycompai/design-system';
import {
  Certificate,
  Download,
  InformationFilled,
  WarningAltFilled,
} from '@trycompai/design-system/icons';
import { usePermissions } from '@/hooks/use-permissions';
import { downloadCertificate } from './certificate-download';
import {
  TONE_CLASSES,
  TrainingGroupPanel,
  formatDate,
  safeEmployeeName,
  type EmployeeWithUser,
} from './TrainingGroupPanel';
import type { TrainingTone } from './training-status-text';

interface EmployeeTrainingVideosProps {
  employee: EmployeeWithUser;
  organization: Organization;
  /** Undefined when the org does not require general security training. */
  view: TrainingGroupView | undefined;
}

interface EmployeeHipaaTrainingProps {
  employee: EmployeeWithUser;
  organization: Organization;
  view: TrainingGroupView;
}

export function EmployeeTrainingVideos({
  employee,
  organization,
  view,
}: EmployeeTrainingVideosProps) {
  const { hasPermission } = usePermissions();
  // The API requires training:read for certificates; only offer it to those who have it.
  const canDownloadCertificate = hasPermission('training', 'read');

  const handleDownloadCertificate = () =>
    downloadCertificate({
      path: '/v1/training/generate-certificate',
      organizationId: organization.id,
      memberId: employee.id,
      fileName: `training-certificate-${safeEmployeeName(employee)}.pdf`,
    });

  if (!organization.securityTrainingStepEnabled || !view) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-muted bg-muted/30 p-4">
        <span className="shrink-0 text-muted-foreground">
          <InformationFilled size={20} />
        </span>
        <div>
          <Text weight="medium">Security training is managed outside of Dilligent</Text>
          <Text size="sm" variant="muted">
            Evidence for security training completion can be logged in the Security Awareness
            Training evidence task.
          </Text>
        </div>
      </div>
    );
  }

  return (
    <TrainingGroupPanel
      view={view}
      onDownloadCertificate={canDownloadCertificate ? handleDownloadCertificate : undefined}
    />
  );
}

export function EmployeeHipaaTraining({
  employee,
  organization,
  view,
}: EmployeeHipaaTrainingProps) {
  const { status } = view;
  const completedAt = status.status === 'incomplete' ? null : status.completedAt;
  const isExpired = status.status === 'expired';
  const tone: TrainingTone = completedAt === null ? 'muted' : isExpired ? 'danger' : 'success';
  const classes = TONE_CLASSES[tone];

  const { hasPermission } = usePermissions();
  const canDownloadCertificate = hasPermission('training', 'read');

  const handleDownloadCertificate = () =>
    downloadCertificate({
      path: '/v1/training/generate-hipaa-certificate',
      organizationId: organization.id,
      memberId: employee.id,
      fileName: `hipaa-training-certificate-${safeEmployeeName(employee)}.pdf`,
    });

  const title = isExpired
    ? 'HIPAA Security Awareness Training Expired'
    : completedAt
      ? 'HIPAA Security Awareness Training Acknowledged'
      : 'HIPAA Security Awareness Training Not Completed';

  const detail =
    status.status === 'expired'
      ? `Acknowledged on ${formatDate(status.completedAt)}. Expired on ${formatDate(status.validUntil)}.`
      : status.status === 'renewal_due'
        ? `Acknowledged on ${formatDate(status.completedAt)}. Renewal due by ${formatDate(status.validUntil)}.`
        : completedAt
          ? `Acknowledged on ${formatDate(completedAt)}`
          : 'Employee has not yet acknowledged the HIPAA training in the portal.';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4',
        classes.banner,
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            completedAt === null ? 'text-destructive' : classes.icon,
          )}
        >
          {completedAt ? <Certificate size={20} /> : <WarningAltFilled size={20} />}
        </span>
        <div>
          <Text weight="medium">{title}</Text>
          <Text size="sm" variant="muted">
            {detail}
          </Text>
        </div>
      </div>
      {completedAt && canDownloadCertificate && (
        <Button
          type="button"
          size="sm"
          iconLeft={<Download size={16} />}
          onClick={handleDownloadCertificate}
        >
          Certificate
        </Button>
      )}
    </div>
  );
}
