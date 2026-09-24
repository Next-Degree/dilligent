const SOURCE_LABELS: Record<string, string> = {
  google_workspace: 'Google Workspace sign-in',
};

/**
 * Description for a vendor created from a discovered candidate.
 *
 * `Vendor.description` is non-null, and a vendor created with an empty one leaves the
 * register unreadable for whoever audits it months later. The catalogue, integration or
 * inferred description is preferred; where none exists this states plainly what was observed
 * and when, which is more useful than a placeholder.
 */
export function buildDiscoveredVendorDescription({
  candidateDescription,
  source,
  discoveredAt,
  granteeCount,
}: {
  candidateDescription: string | null;
  source: string;
  discoveredAt: Date;
  granteeCount: number;
}): string {
  const preferred = candidateDescription?.trim();
  if (preferred) {
    return preferred;
  }

  const label = SOURCE_LABELS[source] ?? source;
  const date = discoveredAt.toISOString().slice(0, 10);
  const people = granteeCount === 1 ? '1 employee has' : `${granteeCount} employees have`;

  return `Discovered via ${label} on ${date}. ${people} granted access.`;
}
