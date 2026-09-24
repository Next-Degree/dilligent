'use client';

import type { AccessProvenance } from '@/hooks/use-access-revocations';
import { Badge } from '@trycompai/design-system';

/**
 * Says where this list came from.
 *
 * The distinction matters during an offboarding review: a list scoped to what was actually
 * observed can be worked through and trusted, while the full register is a fallback that
 * carries no evidence about this person at all. Presenting the second as if it were the
 * first would invite someone to tick off vendors nobody checked.
 */
export function AccessScopeNotice({
  scopedToObservedAccess,
}: {
  scopedToObservedAccess?: boolean;
}) {
  if (scopedToObservedAccess === undefined) {
    return null;
  }

  return (
    <p className="text-xs text-muted-foreground">
      {scopedToObservedAccess
        ? 'Showing the vendors this person has authorized access to, plus anything already revoked. Apps signed into another way will not appear — add any others below.'
        : 'No observed access data is available, so every vendor is listed. Connect Google Workspace to narrow this to what this person actually has.'}
    </p>
  );
}

const LABELS: Record<AccessProvenance, string | null> = {
  observed: 'Observed',
  'revoked-previously': 'Previously revoked',
  // In full-register mode every row is a fallback, so a per-row badge is only noise.
  'full-register': null,
};

/** Per-row provenance. Renders nothing when the label would carry no information. */
export function AccessProvenanceBadge({ provenance }: { provenance?: AccessProvenance }) {
  const label = provenance ? LABELS[provenance] : null;
  if (!label) return null;

  return (
    <span>
      <Badge variant="outline">{label}</Badge>
    </span>
  );
}
