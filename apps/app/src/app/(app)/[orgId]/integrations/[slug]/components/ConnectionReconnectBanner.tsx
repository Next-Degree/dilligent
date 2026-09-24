'use client';

import { CLOUD_RECONNECT_CUTOFF_LABEL } from '@/lib/cloud-reconnect-policy';
import { Button } from '@trycompai/design-system';

export type ReconnectReason = 'cloud-cutoff' | 'missing-scopes';

interface ConnectionReconnectBannerProps {
  reason: ReconnectReason;
  /** Only meaningful for `missing-scopes`; drives the count in the copy. */
  missingScopes?: string[];
  onReconnect: () => void;
}

/**
 * Prompt to re-authorize a connection that still works but is missing something.
 *
 * Two distinct causes share one presentation: a cloud connection predating the credential
 * cutoff, and an OAuth connection whose consent predates a scope the manifest now requires.
 * The second is invisible without this — every other check keeps passing while the one
 * needing the new permission fails with a bare 403.
 */
export function ConnectionReconnectBanner({
  reason,
  missingScopes = [],
  onReconnect,
}: ConnectionReconnectBannerProps) {
  const isScopeGap = reason === 'missing-scopes';
  const permissionCount = missingScopes.length;

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {isScopeGap ? 'Additional permission needed' : 'Reconnect this account'}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isScopeGap
            ? `This connection was authorized before ${
                permissionCount === 1 ? 'a permission' : `${permissionCount} permissions`
              } we now need ${permissionCount === 1 ? 'was' : 'were'} added. Reconnect to grant ` +
              'it — your existing access is kept.'
            : `This connection was created before ${CLOUD_RECONNECT_CUTOFF_LABEL}. Reconnect it to ` +
              'keep scans and remediation fully reliable.'}
        </p>
      </div>
      <div className="shrink-0">
        <Button size="sm" variant="outline" onClick={onReconnect}>
          Reconnect
        </Button>
      </div>
    </div>
  );
}
