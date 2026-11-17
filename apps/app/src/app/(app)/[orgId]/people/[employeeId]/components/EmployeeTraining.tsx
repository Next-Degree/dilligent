'use client';

import { ccpaTrainingVideos, trainingVideos } from '@/lib/data/training-videos';
import type { TrainingGroupView } from '@/lib/training/training-view';
import { cn } from '@/lib/utils';
import type { Member, Organization, User } from '@db';
import { Button, Stack, Text } from '@trycompai/design-system';
import {
  Certificate,
  CheckmarkFilled,
  Download,
  InformationFilled,
  WarningAltFilled,
} from '@trycompai/design-system/icons';
import { downloadHipaaCertificate } from '../actions/download-hipaa-certificate';
import { downloadTrainingCertificate } from '../actions/download-training-certificate';
import { downloadBase64Pdf } from './downloadBase64Pdf';
import {
  describeTrainingStatus,
  type TrainingStatusText,
  type TrainingTone,
} from './training-status-text';

type EmployeeWithUser = Member & { user: User };

interface EmployeeTrainingVideosProps {
  employee: EmployeeWithUser;
  organization: Organization;
  /** Undefined when the org does not require general security training. */
  view: TrainingGroupView | undefined;
}

interface EmployeeCcpaTrainingProps {
  employee: EmployeeWithUser;
  view: TrainingGroupView;
}

interface EmployeeHipaaTrainingProps {
  employee: EmployeeWithUser;
  organization: Organization;
  view: TrainingGroupView;
}

const TONE_CLASSES: Record<TrainingTone, { banner: string; icon: string }> = {
  muted: { banner: 'border-muted bg-muted/30', icon: 'bg-muted text-muted-foreground' },
  success: { banner: 'border-primary/20 bg-primary/5', icon: 'bg-primary/10 text-primary' },
  warning: { banner: 'border-warning/30 bg-warning/5', icon: 'bg-warning/10 text-warning' },
  danger: {
    banner: 'border-destructive/30 bg-destructive/5',
    icon: 'bg-destructive/10 text-destructive',
  },
};

function safeEmployeeName(employee: EmployeeWithUser): string {
  return employee.user.name?.replace(/\s+/g, '-').toLowerCase() || 'employee';
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function moduleTitle({
  view,
  videoId,
  index,
}: {
  view: TrainingGroupView;
  videoId: string;
  index: number;
}): string {
  return (
    [...trainingVideos, ...ccpaTrainingVideos].find((video) => video.id === videoId)?.title ??
    `${view.group.title}, part ${index + 1}`
  );
}

function StatusBanner({
  text,
  onDownloadCertificate,
}: {
  text: TrainingStatusText;
  onDownloadCertificate: (() => void) | undefined;
}) {
  const classes = TONE_CLASSES[text.tone];

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4',
        classes.banner,
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            classes.icon,
          )}
        >
          <Certificate size={20} />
        </div>
        <div>
          <Text weight="medium">{text.title}</Text>
          {text.detail && (
            <Text size="sm" variant="muted">
              {text.detail}
            </Text>
          )}
        </div>
      </div>
      {onDownloadCertificate && (
        <Button
          type="button"
          size="sm"
          iconLeft={<Download size={16} />}
          onClick={onDownloadCertificate}
        >
          Certificate
        </Button>
      )}
    </div>
  );
}

function TrainingGroupPanel({
  view,
  onDownloadCertificate,
}: {
  view: TrainingGroupView;
  /** Only passed for groups that have a certificate to download. */
  onDownloadCertificate: (() => void) | undefined;
}) {
  // A certificate records a completion that really happened, so it stays
  // available for the latest finished cycle even once that cycle has expired.
  const hasCompletedCycle = view.status.status !== 'incomplete';

  return (
    <Stack gap="md">
      <StatusBanner
        text={describeTrainingStatus({ view, formatDate })}
        onDownloadCertificate={hasCompletedCycle ? onDownloadCertificate : undefined}
      />

      <Stack gap="sm">
        {view.modules.map((module, index) => {
          const isCompleted = module.completedAt !== null;

          return (
            <div
              key={module.videoId}
              className="flex items-center justify-between gap-2 rounded-md border p-3"
            >
              <Stack gap="xs">
                <div className="flex items-center gap-2">
                  <span className={isCompleted ? 'text-primary' : 'text-destructive'}>
                    {isCompleted ? <CheckmarkFilled size={16} /> : <WarningAltFilled size={16} />}
                  </span>
                  <Text>{moduleTitle({ view, videoId: module.videoId, index })}</Text>
                </div>
                {module.completedAt && (
                  <Text size="xs" variant="muted">
                    Completed - {new Date(module.completedAt).toLocaleDateString()}
                  </Text>
                )}
              </Stack>
            </div>
          );
        })}
      </Stack>
    </Stack>
  );
}

export function EmployeeTrainingVideos({
  employee,
  organization,
  view,
}: EmployeeTrainingVideosProps) {
  const handleDownloadCertificate = async () => {
    const result = await downloadTrainingCertificate({
      memberId: employee.id,
      organizationId: organization.id,
    });
    if (result?.data) {
      downloadBase64Pdf(result.data, `training-certificate-${safeEmployeeName(employee)}.pdf`);
    }
  };

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

  return <TrainingGroupPanel view={view} onDownloadCertificate={handleDownloadCertificate} />;
}

export function EmployeeCcpaTraining({ view }: EmployeeCcpaTrainingProps) {
  return <TrainingGroupPanel view={view} onDownloadCertificate={undefined} />;
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

  const handleDownloadCertificate = async () => {
    const result = await downloadHipaaCertificate({
      memberId: employee.id,
      organizationId: organization.id,
    });
    if (result?.data) {
      downloadBase64Pdf(
        result.data,
        `hipaa-training-certificate-${safeEmployeeName(employee)}.pdf`,
      );
    }
  };

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
      {completedAt && (
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
