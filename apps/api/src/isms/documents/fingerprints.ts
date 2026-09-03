/**
 * Drift fingerprints for the parts of the ISMS snapshot that are too detailed to
 * compare field by field. Kept apart from `data-source.ts`, which owns the queries.
 */

import { createHash } from 'node:crypto';

/**
 * The canonicalization every fingerprint here shares: rows arrive JSON-encoded (so
 * field boundaries can never collide), are sorted so the digest is independent of
 * row order, and an empty set hashes to the empty string rather than to the digest
 * of nothing.
 *
 * The separator is a parameter only because the two fingerprints below shipped with
 * different ones and both are already stored in customers' snapshots: harmonising
 * them would change every stored digest and report drift on documents whose
 * rendered content never moved.
 */
function hashRows({
  rows,
  separator,
}: {
  rows: string[];
  separator: string;
}): string {
  if (rows.length === 0) return '';
  return createHash('sha256').update(rows.sort().join(separator)).digest('hex');
}

/**
 * Stable, order-insensitive SHA-256 of the parties register rows. The
 * Requirements document derives one row per party, so a manual party edit (name
 * or category) — otherwise invisible to the platform snapshot — must change this
 * fingerprint and flag requirements drift.
 */
export function fingerprintParties(
  rows: Array<{ id: string; name: string; category: string }>,
): string {
  return hashRows({
    rows: rows.map((row) => JSON.stringify([row.id, row.name, row.category])),
    separator: '\u0001',
  });
}

/**
 * Stable, order-insensitive SHA-256 over everything the Risk Treatment Plan
 * (6.1.3) renders: non-archived Risk Register rows, vendor risk fields, and
 * acceptance events (append-only, so their ids alone capture "a new acceptance
 * was recorded"). Two subtleties: (1) archived risks leave the plan, so
 * archiving changes the row set (= drift) while later edits to an archived risk
 * stay invisible — acceptance rows are filtered to the RENDERED subjects for the
 * same reason; (2) the fingerprint carries the rendered owner DISPLAY value (not
 * the id), so a member rename that changes the exported owner cell also drifts.
 */
export function fingerprintRiskTreatment({
  risks,
  vendors,
  acceptances,
}: {
  risks: Array<{
    id: string;
    title: string;
    category: string;
    status: string;
    likelihood: string;
    impact: string;
    residualLikelihood: string;
    residualImpact: string;
    treatmentStrategy: string;
    treatmentStrategyDescription: string | null;
    assigneeId: string | null;
    assignee: { user: { name: string | null; email: string } } | null;
  }>;
  vendors: Array<{
    id: string;
    name: string;
    category: string;
    status: string;
    inherentProbability: string;
    inherentImpact: string;
    residualProbability: string;
    residualImpact: string;
    treatmentStrategy: string;
    treatmentStrategyDescription: string | null;
    assigneeId: string | null;
    assignee: { user: { name: string | null; email: string } } | null;
  }>;
  acceptances: Array<{
    id: string;
    riskId: string | null;
    vendorId: string | null;
  }>;
}): string {
  const ownerDisplay = (
    assignee: { user: { name: string | null; email: string } } | null,
  ): string =>
    assignee ? assignee.user.name?.trim() || assignee.user.email : '';
  const renderedRisks = risks.filter((risk) => risk.status !== 'archived');
  const renderedSubjectIds = new Set([
    ...renderedRisks.map((risk) => risk.id),
    ...vendors.map((vendor) => vendor.id),
  ]);
  const rows = [
    ...renderedRisks.map((risk) =>
      JSON.stringify([
        'risk',
        risk.id,
        risk.title,
        risk.category,
        risk.status,
        risk.likelihood,
        risk.impact,
        risk.residualLikelihood,
        risk.residualImpact,
        risk.treatmentStrategy,
        risk.treatmentStrategyDescription ?? '',
        risk.assigneeId ?? '',
        ownerDisplay(risk.assignee),
      ]),
    ),
    // No delivery models or data service types: the plan renders name, category,
    // ratings, treatment, controls and owner only, so hashing them would mark it
    // stale on every delivery-model edit and regenerate a byte-identical document.
    // That dimension drives scope drift instead, where it IS rendered.
    ...vendors.map((vendor) =>
      JSON.stringify([
        'vendor',
        vendor.id,
        vendor.name,
        vendor.category,
        vendor.status,
        vendor.inherentProbability,
        vendor.inherentImpact,
        vendor.residualProbability,
        vendor.residualImpact,
        vendor.treatmentStrategy,
        vendor.treatmentStrategyDescription ?? '',
        vendor.assigneeId ?? '',
        ownerDisplay(vendor.assignee),
      ]),
    ),
    ...acceptances
      .filter((acceptance) =>
        renderedSubjectIds.has(acceptance.riskId ?? acceptance.vendorId ?? ''),
      )
      .map((acceptance) =>
        JSON.stringify([
          'acceptance',
          acceptance.id,
          acceptance.riskId ?? '',
          acceptance.vendorId ?? '',
        ]),
      ),
  ];
  return hashRows({ rows, separator: '' });
}
