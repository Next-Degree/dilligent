'use client';

import {
  HIPAA_TRAINING_ID,
  hipaaAcknowledgements,
} from '@/lib/data/hipaa-training-content';
import { useTrainingCompletions } from '@/hooks/use-training-completions';
import { formatShortDate } from '@/lib/format-date';
import { getGroupProgress } from '@/lib/training/group-progress';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  cn,
} from '@trycompai/design-system';
import { CheckmarkFilled, CircleDash } from '@trycompai/design-system/icons';
import { useState } from 'react';
import { HipaaTrainingContent } from './HipaaTrainingContent';

export function HipaaTrainingAccordionItem() {
  const { completions, markVideoComplete } = useTrainingCompletions();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allChecked, setAllChecked] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Record<number, boolean>>({});

  // The acknowledgement renews yearly. It only shows as done while it is valid;
  // once a renewal is due or it has expired the member acknowledges it again,
  // and last year's row must not keep it looking done.
  const progress = getGroupProgress({ groupId: 'hipaa', completions, now: new Date() });
  const { status } = progress;
  const isCompleted = progress.isFullyDone;
  const completedAt = status.status === 'valid' ? status.completedAt : null;

  const handleCheckChange = (index: number, checked: boolean) => {
    const updated = { ...checkedItems, [index]: checked };
    setCheckedItems(updated);
    setAllChecked(
      hipaaAcknowledgements.every((_, i) => updated[i] === true),
    );
  };

  const handleAcknowledge = async () => {
    if (!allChecked || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await markVideoComplete(HIPAA_TRAINING_ID);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border rounded-xs">
      <AccordionItem value="hipaa-training">
        <div className="px-4">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
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
                  isCompleted && 'text-muted-foreground line-through',
                )}
              >
                HIPAA Security Awareness Training
              </span>
              {status.status === 'renewal_due' && (
                <Badge variant="outline">
                  Renew by {formatShortDate(status.validUntil)}
                </Badge>
              )}
              {status.status === 'expired' && (
                <Badge variant="destructive">Expired</Badge>
              )}
            </div>
          </AccordionTrigger>
        </div>
        <AccordionContent>
          <div className="px-4 pb-4 space-y-6">
            <p className="text-muted-foreground text-sm">
              Read the following HIPAA security awareness training and
              acknowledge each statement at the bottom to complete this
              requirement.
            </p>

            {isCompleted ? (
              <CompletedBanner completedAt={completedAt} />
            ) : (
              <>
                {status.status === 'renewal_due' && (
                  <p className="text-sm">
                    Your acknowledgement is due for renewal by{' '}
                    {formatShortDate(status.validUntil)}. Read the training again and
                    acknowledge it to renew before it expires.
                  </p>
                )}
                {status.status === 'expired' && (
                  <p className="text-sm">
                    Your acknowledgement expired on {formatShortDate(status.validUntil)}.
                    Read the training again and acknowledge it to renew.
                  </p>
                )}
                <HipaaTrainingContent />
                <AcknowledgementSection
                  checkedItems={checkedItems}
                  onCheckChange={handleCheckChange}
                  allChecked={allChecked}
                  isSubmitting={isSubmitting}
                  onAcknowledge={handleAcknowledge}
                />
              </>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </div>
  );
}

function CompletedBanner({ completedAt }: { completedAt: Date | null }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="text-primary">
        <CheckmarkFilled size={24} />
      </div>
      <div>
        <p className="font-medium text-sm">
          HIPAA training acknowledged
        </p>
        <p className="text-muted-foreground text-xs">
          {completedAt
            ? `Completed on ${new Date(completedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}. A certificate was emailed to you.`
            : 'You have completed the HIPAA Security Awareness Training.'}
        </p>
      </div>
    </div>
  );
}

function AcknowledgementSection({
  checkedItems,
  onCheckChange,
  allChecked,
  isSubmitting,
  onAcknowledge,
}: {
  checkedItems: Record<number, boolean>;
  onCheckChange: (index: number, checked: boolean) => void;
  allChecked: boolean;
  isSubmitting: boolean;
  onAcknowledge: () => void;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
      <h3 className="font-semibold text-sm">Acknowledgement</h3>
      <p className="text-muted-foreground text-xs">
        By acknowledging this training, you confirm the following:
      </p>
      <div className="space-y-3">
        {hipaaAcknowledgements.map((statement, index) => (
          <label
            key={index}
            className="flex items-start gap-3 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={checkedItems[index] ?? false}
              onChange={(e) => onCheckChange(index, e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border accent-primary shrink-0"
            />
            <span className="text-sm text-foreground leading-snug">
              {statement}
            </span>
          </label>
        ))}
      </div>
      <div>
        <Button
          disabled={!allChecked || isSubmitting}
          loading={isSubmitting}
          onClick={onAcknowledge}
        >
          Acknowledge HIPAA Training
        </Button>
      </div>
    </div>
  );
}
