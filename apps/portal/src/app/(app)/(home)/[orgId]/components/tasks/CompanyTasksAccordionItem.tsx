'use client';

import type { PortalTask } from '@db';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  cn,
} from '@trycompai/design-system';
import {
  ArrowUpRight,
  CheckmarkFilled,
  CircleDash,
} from '@trycompai/design-system/icons';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

export type PortalTaskWithCompletion = PortalTask & {
  completedAt: Date | null;
};

interface CompanyTasksAccordionItemProps {
  organizationId: string;
  tasks: PortalTaskWithCompletion[];
}

function getActionLabel({
  task,
  isCompleted,
  isSaving,
}: {
  task: PortalTaskWithCompletion;
  isCompleted: boolean;
  isSaving: boolean;
}): string {
  if (isCompleted) return 'Completed';
  if (isSaving) return 'Saving...';

  return task.kind === 'link' ? 'Mark as done' : 'I acknowledge';
}

export function CompanyTasksAccordionItem({
  organizationId,
  tasks,
}: CompanyTasksAccordionItemProps) {
  const router = useRouter();
  const [completedIds, setCompletedIds] = useState<string[]>(
    tasks.filter((task) => task.completedAt !== null).map((task) => task.id),
  );
  const [completingId, setCompletingId] = useState<string | null>(null);

  const requiredTasks = tasks.filter((task) => task.isRequired);
  const hasCompletedRequired = requiredTasks.every((task) =>
    completedIds.includes(task.id),
  );

  const handleComplete = async (taskId: string) => {
    setCompletingId(taskId);
    try {
      const res = await fetch('/api/portal/complete-portal-task', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portalTaskId: taskId, organizationId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to complete task');
      }

      setCompletedIds((current) => [...current, taskId]);
      toast.success('Task completed');
      // Refresh so the outer progress counter picks up the new completion.
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to complete task',
      );
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <div className="border rounded-xs">
      <AccordionItem value="company-tasks">
        <div className="px-4 [&[data-state=open]]:pb-2">
          <AccordionTrigger>
            <div className="flex items-center gap-3">
              {hasCompletedRequired ? (
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
                  'text-base text-left',
                  hasCompletedRequired && 'text-muted-foreground line-through',
                )}
              >
                Complete company tasks
              </span>
            </div>
          </AccordionTrigger>
        </div>
        <AccordionContent>
          <div className="px-4 pb-4 space-y-4">
            {tasks.map((task) => {
              const isCompleted = completedIds.includes(task.id);

              return (
                <div
                  key={task.id}
                  className="flex flex-col gap-3 border-b pb-4 last:border-b-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      {isCompleted && (
                        <div className="text-primary shrink-0">
                          <CheckmarkFilled size={12} />
                        </div>
                      )}
                      <span
                        className={cn(
                          'text-sm font-medium',
                          isCompleted && 'text-muted-foreground line-through',
                        )}
                      >
                        {task.title}
                      </span>
                      {!task.isRequired && (
                        <span className="text-muted-foreground text-xs">
                          Optional
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p className="text-muted-foreground text-sm">
                        {task.description}
                      </p>
                    )}
                    {task.kind === 'link' && task.externalUrl && (
                      <a
                        href={task.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-primary inline-flex items-center gap-1 text-sm underline transition-colors"
                      >
                        Open link
                        <ArrowUpRight size={14} />
                      </a>
                    )}
                  </div>
                  <div className="shrink-0">
                    <Button
                      onClick={() => handleComplete(task.id)}
                      disabled={isCompleted || completingId === task.id}
                    >
                      {getActionLabel({
                        task,
                        isCompleted,
                        isSaving: completingId === task.id,
                      })}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </div>
  );
}
