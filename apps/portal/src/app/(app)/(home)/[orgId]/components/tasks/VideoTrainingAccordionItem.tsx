'use client';

import { useTrainingCompletions } from '@/hooks/use-training-completions';
import type { TrainingVideo } from '@/lib/data/training-videos';
import { getGroupProgress } from '@/lib/training/group-progress';
import type { TrainingGroupId } from '@trycompai/company/training';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  cn,
} from '@trycompai/design-system';
import { CheckmarkFilled, CircleDash } from '@trycompai/design-system/icons';
import { VideoCarousel } from '../video/VideoCarousel';

interface VideoTrainingAccordionItemProps {
  /** Unique accordion value for this item. */
  value: string;
  title: string;
  description: string;
  groupId: TrainingGroupId;
  videos: readonly TrainingVideo[];
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * One video based training the employee works through: a checklist entry that
 * opens onto the videos.
 *
 * Training renews yearly, so the entry has more states than done or not done:
 * a renewal that is due still counts as satisfied (and shows a check) but
 * invites the member to watch again, and an expired one asks for the whole
 * training again, showing how far the renewal has got.
 */
export function VideoTrainingAccordionItem({
  value,
  title,
  description,
  groupId,
  videos,
}: VideoTrainingAccordionItemProps) {
  const { completions } = useTrainingCompletions();
  const progress = getGroupProgress({ groupId, completions, now: new Date() });
  const { status } = progress;

  const completedCount = progress.completedModuleIds.size;
  const totalCount = videos.length;

  return (
    <div className="border rounded-xs">
      <AccordionItem value={value}>
        <div className="px-4">
          <AccordionTrigger>
            <div className="flex flex-wrap items-center gap-3">
              {progress.isSatisfied ? (
                <div className="text-primary">
                  <CheckmarkFilled size={20} />
                </div>
              ) : (
                <div className="text-muted-foreground">
                  <CircleDash size={20} />
                </div>
              )}
              <span
                className={cn(
                  'text-base',
                  progress.isFullyDone && 'text-muted-foreground line-through',
                )}
              >
                {title}
              </span>
              {status.status === 'renewal_due' && (
                <Badge variant="outline">Renew by {formatDate(status.validUntil)}</Badge>
              )}
              {status.status === 'expired' && <Badge variant="destructive">Expired</Badge>}
              {!progress.isSatisfied && totalCount > 0 && (
                <Badge variant="outline">
                  {completedCount}/{totalCount}
                </Badge>
              )}
            </div>
          </AccordionTrigger>
        </div>
        <AccordionContent>
          <div className="px-4 pb-4 space-y-4">
            <p className="text-muted-foreground text-sm">{description}</p>
            {status.status === 'renewal_due' && (
              <p className="text-sm">
                Your training is due for renewal by {formatDate(status.validUntil)}. Watch the
                videos again to renew it before it expires.
              </p>
            )}
            {status.status === 'expired' && (
              <p className="text-sm">
                Your training expired on {formatDate(status.validUntil)}. Watch the videos again to
                renew it.
              </p>
            )}
            <VideoCarousel groupId={groupId} videos={videos} />
          </div>
        </AccordionContent>
      </AccordionItem>
    </div>
  );
}
