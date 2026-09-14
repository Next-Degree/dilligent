'use client';

import { useRealtimeRun } from '@trigger.dev/react-hooks';
import { useMemo } from 'react';
import type { PolicyTailoringStatus } from '../../all/components/policy-tailoring-context';

export interface PolicyOnboardingItemInfo {
  id: string;
  name: string;
}

/**
 * Subscribe to the onboarding trigger.dev run and derive per-policy tailoring
 * status plus overall progress. Mirrors use-onboarding-status in risk/ and
 * vendors/ but handles the `policies` → `policy_<id>_status` singular
 * conversion correctly (the shared hook's `itemType.slice(0, -1)` would
 * produce `policie_`).
 */
export function usePolicyOnboardingStatus(
  onboardingRunId: string | null | undefined,
) {
  const shouldSubscribe = Boolean(onboardingRunId);
  const { run } = useRealtimeRun(shouldSubscribe ? onboardingRunId! : '', {
    enabled: shouldSubscribe,
  });

  // Read the metadata once so every memo below depends on the exact same value
  // the React Compiler infers (the metadata object, not the whole run object).
  const runMetadata = run?.metadata as Record<string, unknown> | undefined;

  const itemStatuses = useMemo<Record<string, PolicyTailoringStatus>>(() => {
    if (!runMetadata) return {};

    const itemsInfo =
      (runMetadata.policiesInfo as Array<{ id: string; name: string }>) || [];

    return itemsInfo.reduce<Record<string, PolicyTailoringStatus>>(
      (acc, item) => {
        const status = runMetadata[`policy_${item.id}_status`];
        if (
          status === 'queued' ||
          status === 'pending' ||
          status === 'processing' ||
          status === 'completed'
        ) {
          acc[item.id] = status;
        }
        return acc;
      },
      {},
    );
  }, [runMetadata]);

  const progress = useMemo(() => {
    if (!runMetadata) return null;

    const total = typeof runMetadata.policiesTotal === 'number' ? runMetadata.policiesTotal : 0;
    const completed =
      typeof runMetadata.policiesCompleted === 'number' ? runMetadata.policiesCompleted : 0;

    if (total === 0) return null;
    return { total, completed };
  }, [runMetadata]);

  const itemsInfo = useMemo<PolicyOnboardingItemInfo[]>(() => {
    if (!runMetadata) return [];
    return (runMetadata.policiesInfo as Array<{ id: string; name: string }>) || [];
  }, [runMetadata]);

  // Active if any item is not yet completed
  const hasActiveItems = useMemo(
    () =>
      Object.values(itemStatuses).some(
        (status) => status !== 'completed' && status !== undefined,
      ),
    [itemStatuses],
  );

  const isRunActive = useMemo(() => {
    if (!run) return false;
    return ['EXECUTING', 'QUEUED', 'WAITING'].includes(run.status);
  }, [run]);

  const hasActiveProgress =
    progress !== null && progress.completed < progress.total;
  const isActive = isRunActive || hasActiveProgress || hasActiveItems;

  return {
    itemStatuses,
    progress,
    itemsInfo,
    isActive,
    isLoading: shouldSubscribe && !run,
    runStatus: run?.status,
  };
}
