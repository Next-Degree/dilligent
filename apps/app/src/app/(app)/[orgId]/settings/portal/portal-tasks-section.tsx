'use client';

import { usePermissions } from '@/hooks/use-permissions';
import {
  Badge,
  Button,
  SettingGroup,
  SettingRow,
  Switch,
} from '@trycompai/design-system';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  usePortalTasks,
  type PortalTaskInput,
  type PortalTaskRow,
} from './hooks/use-portal-tasks';
import { PortalTaskForm } from './portal-task-form';

interface PortalTasksSectionProps {
  initialTasks?: PortalTaskRow[];
}

function describeTask(task: PortalTaskRow): string {
  const optional = task.isRequired ? '' : ' · optional';

  if (!task.isPublished) return `Draft — not assigned yet${optional}`;

  return `${task.completedCount} of ${task.audienceCount} completed${optional}`;
}

/**
 * Custom portal tasks are assigned to the whole portal audience — publishing a
 * task is the assignment, so there is no per-person picker here by design.
 */
export function PortalTasksSection({ initialTasks }: PortalTasksSectionProps) {
  const { hasPermission } = usePermissions();
  const { tasks, isLoading, createTask, updateTask, setPublished, archiveTask } =
    usePortalTasks({ initialData: initialTasks });

  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PortalTaskRow | undefined>();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const canCreate = hasPermission('task', 'create');
  const canUpdate = hasPermission('task', 'update');
  const canDelete = hasPermission('task', 'delete');

  const handleOpenCreate = () => {
    setEditingTask(undefined);
    setFormOpen(true);
  };

  const handleOpenEdit = (task: PortalTaskRow) => {
    setEditingTask(task);
    setFormOpen(true);
  };

  const handleSubmit = async (values: PortalTaskInput) => {
    try {
      if (editingTask) {
        await updateTask(editingTask.id, values);
        toast.success('Task updated');
        return;
      }
      await createTask(values);
      toast.success('Task created as a draft — publish it to assign it');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save the task',
      );
      throw error;
    }
  };

  const handleTogglePublished = async (
    task: PortalTaskRow,
    isPublished: boolean,
  ) => {
    setPendingId(task.id);
    try {
      await setPublished(task.id, isPublished);
      toast.success(
        isPublished
          ? 'Task published to everyone in the portal'
          : 'Task moved back to draft',
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update the task',
      );
    } finally {
      setPendingId(null);
    }
  };

  const handleArchive = async (task: PortalTaskRow) => {
    setPendingId(task.id);
    try {
      await archiveTask(task.id);
      toast.success('Task archived');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to archive the task',
      );
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-medium">Custom Tasks</h2>
          <p className="text-muted-foreground text-sm">
            Extra tasks and acknowledgements for the employee portal. Publishing
            a task assigns it to everyone who completes compliance tasks.
          </p>
        </div>
        {canCreate && (
          <div className="shrink-0">
            <Button onClick={handleOpenCreate}>Add task</Button>
          </div>
        )}
      </div>

      {isLoading && (
        <p className="text-muted-foreground text-sm">Loading tasks...</p>
      )}

      {!isLoading && tasks.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No custom tasks yet. Add one to track an acknowledgement across the
          whole workforce.
        </p>
      )}

      {tasks.length > 0 && (
        <SettingGroup>
          {tasks.map((task) => (
            <SettingRow
              key={task.id}
              size="lg"
              label={task.title}
              description={describeTask(task)}
            >
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div>
                  <Badge variant={task.isPublished ? 'default' : 'outline'}>
                    {task.isPublished ? 'Published' : 'Draft'}
                  </Badge>
                </div>
                <Switch
                  aria-label={
                    task.isPublished ? 'Unpublish task' : 'Publish task'
                  }
                  checked={task.isPublished}
                  onCheckedChange={(checked) =>
                    handleTogglePublished(task, checked)
                  }
                  disabled={!canUpdate || pendingId === task.id}
                />
                {canUpdate && (
                  <Button variant="outline" onClick={() => handleOpenEdit(task)}>
                    Edit
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="ghost"
                    onClick={() => handleArchive(task)}
                    disabled={pendingId === task.id}
                  >
                    Archive
                  </Button>
                )}
              </div>
            </SettingRow>
          ))}
        </SettingGroup>
      )}

      {formOpen && (
        <PortalTaskForm
          // Remount per task so the form picks up the right default values.
          key={editingTask?.id ?? 'new'}
          open={formOpen}
          onOpenChange={setFormOpen}
          task={editingTask}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
}
