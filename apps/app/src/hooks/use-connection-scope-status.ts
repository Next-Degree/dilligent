'use client';

import { useApiSWR } from './use-api-swr';

interface ConnectionScopeStatusResponse {
  missingScopes?: string[];
  reconnectRequired?: boolean;
}

export interface ConnectionScopeStatus {
  missingScopes: string[];
  reconnectRequired: boolean;
}

/**
 * Whether a connection's OAuth consent predates a scope its manifest now requires.
 *
 * Granting consent does not update retroactively, so a connection made before a scope was
 * added keeps working for every other check while silently lacking the new permission —
 * which surfaces as an unexplained permissions error rather than as something the customer
 * can act on. This reads the connection detail endpoint, which reports the gap.
 *
 * Defaults to "no reconnect needed" while loading and on error, so a transient failure
 * never puts a reconnect prompt in front of someone who does not need one.
 */
export function useConnectionScopeStatus(connectionId: string | null): ConnectionScopeStatus {
  const { data } = useApiSWR<ConnectionScopeStatusResponse>(
    connectionId ? `/v1/integrations/connections/${connectionId}` : null,
  );

  const connection = data?.data;

  return {
    missingScopes: connection?.missingScopes ?? [],
    reconnectRequired: connection?.reconnectRequired === true,
  };
}
