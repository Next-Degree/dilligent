import { z } from 'zod';
import type { Prisma } from '@db';
import type { CheckResultRow } from '../../integration-platform/services/check-results.service';

/**
 * The provider-agnostic fields an access check records about a person. Every
 * field is optional and individually fault-tolerant: a provider that reports
 * `role` as a number must not cost us the rest of the row (or the row itself).
 *
 * `evidence` is check-SPECIFIC JSON that CheckResultsService deliberately does
 * not interpret — validating it here, at the feature's edge, is the contract.
 */
const AccessEvidenceSchema = z.object({
  email: z.string().nullish().catch(null),
  name: z.string().nullish().catch(null),
  role: z.string().nullish().catch(null),
  isAdmin: z.boolean().nullish().catch(null),
  status: z.string().nullish().catch(null),
  lastLogin: z.string().nullish().catch(null),
});

export interface VendorIntegrationUser {
  /** Provider-native identity for the person (an email for well-behaved checks). */
  resourceId: string;
  email: string | null;
  name: string | null;
  role: string | null;
  isAdmin: boolean | null;
  /** Provider-reported account status (e.g. 'active', 'suspended'). */
  status: string | null;
  lastLogin: string | null;
  /** False when at least one check flagged this person (e.g. missing 2FA). */
  passed: boolean;
  /** Checks that reported this person, so the UI can attribute the access. */
  checks: Array<{ checkId: string; checkName: string }>;
  collectedAt: Date;
  /** The org member this person resolves to, when their email matches one. */
  member: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    deactivated: boolean;
  } | null;
}

/**
 * A check result tagged with the check that produced it. `CheckResultRow` is
 * per-check by construction (you fetch one check's rows at a time), so the
 * caller carries the check id forward when merging several checks' rows.
 */
export type TaggedCheckResultRow = CheckResultRow & { checkId: string };

export type MemberByEmail = ReadonlyMap<
  string,
  NonNullable<VendorIntegrationUser['member']>
>;

const normalizeEmail = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
};

/** An email only when the value actually looks like one. */
const asEmail = (value: string | null | undefined): string | null => {
  const normalized = normalizeEmail(value);
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
};

function parseEvidence(evidence: Prisma.JsonValue) {
  const parsed = AccessEvidenceSchema.safeParse(evidence);
  return parsed.success ? parsed.data : null;
}

/**
 * Collapse `'user'` check results into one entry per person.
 *
 * Several checks on the same integration report the same people (an access
 * check and a 2FA check, say), so rows are keyed by email — falling back to the
 * raw `resourceId` when the provider exposes no email. A failing row always
 * wins the `passed` flag: if any check flagged the person, the UI must show it.
 */
export function toVendorIntegrationUsers({
  results,
  checkNamesById,
  membersByEmail,
}: {
  results: readonly TaggedCheckResultRow[];
  checkNamesById: ReadonlyMap<string, string>;
  membersByEmail: MemberByEmail;
}): VendorIntegrationUser[] {
  const byIdentity = new Map<string, VendorIntegrationUser>();

  for (const result of results) {
    const evidence = parseEvidence(result.evidence);
    const email = asEmail(result.resourceId) ?? asEmail(evidence?.email);
    const identity = email ?? normalizeEmail(result.resourceId);
    if (!identity) continue;

    const checkName =
      checkNamesById.get(result.checkId) ?? result.title ?? result.checkId;
    const existing = byIdentity.get(identity);

    if (!existing) {
      byIdentity.set(identity, {
        resourceId: result.resourceId,
        email,
        name: evidence?.name ?? null,
        role: evidence?.role ?? null,
        isAdmin: evidence?.isAdmin ?? null,
        status: evidence?.status ?? null,
        lastLogin: evidence?.lastLogin ?? null,
        passed: result.passed,
        checks: [{ checkId: result.checkId, checkName }],
        collectedAt: result.collectedAt,
        member: email ? (membersByEmail.get(email) ?? null) : null,
      });
      continue;
    }

    existing.passed = existing.passed && result.passed;
    existing.name ??= evidence?.name ?? null;
    existing.role ??= evidence?.role ?? null;
    existing.isAdmin ??= evidence?.isAdmin ?? null;
    existing.status ??= evidence?.status ?? null;
    existing.lastLogin ??= evidence?.lastLogin ?? null;
    if (result.collectedAt > existing.collectedAt) {
      existing.collectedAt = result.collectedAt;
    }
    if (!existing.checks.some((check) => check.checkId === result.checkId)) {
      existing.checks.push({ checkId: result.checkId, checkName });
    }
  }

  // Stable, useful order: flagged people first, then by display identity.
  return Array.from(byIdentity.values()).sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1;
    return (a.email ?? a.resourceId).localeCompare(b.email ?? b.resourceId);
  });
}
