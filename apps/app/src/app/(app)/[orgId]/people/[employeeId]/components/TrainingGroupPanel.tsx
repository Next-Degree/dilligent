'use client';

import { ccpaTrainingVideos, trainingVideos } from '@/lib/data/training-videos';
import type { TrainingGroupView } from '@/lib/training/training-view';
import { cn } from '@/lib/utils';
import type { Member, User } from '@db';
import { Button, Stack, Text } from '@trycompai/design-system';
import {
  Certificate,
  CheckmarkFilled,
  Download,
  WarningAltFilled,
} from '@trycompai/design-system/icons';
import {
  describeTrainingStatus,
  type TrainingStatusText,
  type TrainingTone,
} from './training-status-text';

export type EmployeeWithUser = Member & { user: User };

export const TONE_CLASSES: Record<TrainingTone, { banner: string; icon: string }> = {
  muted: { banner: 'border-muted bg-muted/30', icon: 'bg-muted text-muted-foreground' },
  success: { banner: 'border-primary/20 bg-primary/5', icon: 'bg-primary/10 text-primary' },
  warning: { banner: 'border-warning/30 bg-warning/5', icon: 'bg-warning/10 text-warning' },
  danger: {
    banner: 'border-destructive/30 bg-destructive/5',
    icon: 'bg-destructive/10 text-destructive',
  },
};

export function safeEmployeeName(employee: EmployeeWithUser): string {
  return employee.user.name?.replace(/\s+/g, '-').toLowerCase() || 'employee';
}

export function formatDate(date: Date): string {
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

export function TrainingGroupPanel({
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
