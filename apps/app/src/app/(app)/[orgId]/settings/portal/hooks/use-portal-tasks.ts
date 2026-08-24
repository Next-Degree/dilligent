'use client';

import { apiClient } from '@/lib/api-client';
import useSWR from 'swr';

export type PortalTaskKind = 'acknowledgement' | 'link';

export interface PortalTaskRow {
  id: string;
  title: string;
  description: string | null;
  kind: PortalTaskKind;
  externalUrl: string | null;
  acknowledgementText: string | null;
  isPublished: boolean;
  isRequired: boolean;
  isArchived: boolean;
  order: number;
  /** Members in the portal audience who have completed this task. */
  completedCount: number;
  /** Size of the portal audience — everyone with the compliance obligation. */
  audienceCount: number;
}

export interface PortalTaskInput {
  title: string;
  description?: string;
  kind: PortalTaskKind;
  externalUrl?: string;
  acknowledgementText?: string;
  isRequired: boolean;
}

export const portalTasksKey = () => ['/v1/portal-tasks'] as const;

interface UsePortalTasksOptions {
  initialData?: PortalTaskRow[];
}

export function usePortalTasks({ initialData }: UsePortalTasksOptions = {}) {
  const { data, error, isLoading, mutate } = useSWR(
    portalTasksKey(),
    async () => {
      const response = await apiClient.get<PortalTaskRow[]>('/v1/portal-tasks');
      if (response.error) throw new Error(response.error);
      return response.data ?? [];
    },
    {
      fallbackData: initialData,
      revalidateOnMount: !initialData,
      revalidateOnFocus: false,
    },
  );

  // SWR can hand back stale or undefined data between revalidations.
  const tasks = Array.isArray(data) ? data : [];

  const createTask = async (body: PortalTaskInput) => {
    const response = await apiClient.post<PortalTaskRow>(
      '/v1/portal-tasks',
      body,
    );
    if (response.error) throw new Error(response.error);
    await mutate();
    return response.data;
  };

  const updateTask = async (id: string, body: Partial<PortalTaskInput>) => {
    const response = await apiClient.patch<PortalTaskRow>(
      `/v1/portal-tasks/${id}`,
      body,
    );
    if (response.error) throw new Error(response.error);
    await mutate();
    return response.data;
  };

  /**
   * Publishing is the assignment: a published task shows for every member with
   * the compliance obligation, and unpublishing pulls it back to draft.
   */
  const setPublished = async (id: string, isPublished: boolean) => {
    const previous = tasks;

    await mutate(
      tasks.map((task) => (task.id === id ? { ...task, isPublished } : task)),
      false,
    );

    try {
      const response = await apiClient.patch(`/v1/portal-tasks/${id}`, {
        isPublished,
      });
      if (response.error) throw new Error(response.error);
      await mutate();
    } catch (err) {
      await mutate(previous, false);
      throw err;
    }
  };

  const archiveTask = async (id: string) => {
    const previous = tasks;

    await mutate(
      tasks.filter((task) => task.id !== id),
      false,
    );

    try {
      const response = await apiClient.delete(`/v1/portal-tasks/${id}`);
      if (response.error) throw new Error(response.error);
      await mutate();
    } catch (err) {
      await mutate(previous, false);
      throw err;
    }
  };

  return {
    tasks,
    isLoading: isLoading && !initialData,
    error,
    mutate,
    createTask,
    updateTask,
    setPublished,
    archiveTask,
  };
}
