import { memberIdentityEmails } from '../../people/utils/external-identity';
import { db } from '@db';
import { getManifest } from '@trycompai/integration-platform';
import type {
  CheckResultsService,
  CheckRunSummary,
} from '../../integration-platform/services/check-results.service';
import type {
  VendorIntegrationCheck,
  VendorIntegrationCheckRun,
} from './vendor-integration.types';
import {
  toVendorIntegrationUsers,
  type MemberByEmail,
  type TaggedCheckResultRow,
  type VendorIntegrationUser,
} from './vendor-integration-user';

/** Access checks key people by email — this is the resource shape they emit. */
const USER_RESOURCE_TYPE = 'user';

interface ConnectedIntegration {
  checkResults: CheckResultsService;
  organizationId: string;
  connectionId: string;
  slug: string;
}

/**
 * The connected integration's checks, each with its latest real outcome.
 *
 * Definitions come from the manifest (so a check that has never run still
 * appears, as "not run yet"); outcomes come from the check-results service.
 */
export function loadIntegrationChecks({
  slug,
  runs,
}: {
  slug: string;
  runs: readonly CheckRunSummary[];
}): VendorIntegrationCheck[] {
  // Runs not claimed by a manifest check are left behind for the tail below.
  const unclaimedRuns = new Map(runs.map((run) => [run.checkId, run]));

  const toLastRun = (
    run: (typeof runs)[number] | undefined,
  ): VendorIntegrationCheckRun | null =>
    run
      ? {
          runId: run.runId,
          status: run.status,
          startedAt: run.startedAt?.toISOString() ?? null,
          completedAt: run.completedAt?.toISOString() ?? null,
          totalChecked: run.totalChecked,
          passedCount: run.passedCount,
          failedCount: run.failedCount,
          errorMessage: run.errorMessage,
        }
      : null;

  const checks: VendorIntegrationCheck[] = (
    getManifest(slug)?.checks ?? []
  ).map((definition) => {
    const run = unclaimedRuns.get(definition.id);
    unclaimedRuns.delete(definition.id);
    return {
      checkId: definition.id,
      name: definition.name,
      description: definition.description,
      taskMapping: definition.taskMapping ?? null,
      lastRun: toLastRun(run),
    };
  });

  // A run whose check has since been renamed or removed from the manifest still
  // happened — surface it from the run's own denormalized name rather than
  // dropping evidence the customer can see elsewhere.
  for (const run of unclaimedRuns.values()) {
    checks.push({
      checkId: run.checkId,
      name: run.checkName,
      description: '',
      taskMapping: null,
      lastRun: toLastRun(run),
    });
  }

  return checks;
}

/**
 * The people the connected integration's checks report, merged across checks
 * and joined to org members by email.
 */
export async function loadIntegrationUsers({
  checkResults,
  organizationId,
  connectionId,
  slug,
  runs,
}: ConnectedIntegration & {
  runs: readonly CheckRunSummary[];
}): Promise<VendorIntegrationUser[]> {
  if (runs.length === 0) return [];

  // The runs already name the latest run per check, so every person-scoped row
  // comes back in one query rather than two per manifest check — most of which
  // are empty anyway for a manifest whose checks report other resource types.
  // The member load depends on nothing the rows produce, so it overlaps them
  // rather than costing a further round trip.
  const [results, membersByEmail]: [TaggedCheckResultRow[], MemberByEmail] =
    await Promise.all([
      checkResults.getResultsByRunIds({
        organizationId,
        connectionId,
        runs,
        resourceType: USER_RESOURCE_TYPE,
      }),
      loadMembersByEmail({ organizationId, slug }),
    ]);
  if (results.length === 0) return [];

  const definitions = getManifest(slug)?.checks ?? [];
  return toVendorIntegrationUsers({
    results,
    checkNamesById: new Map([
      ...runs.map((run): [string, string] => [run.checkId, run.checkName]),
      ...definitions.map((d): [string, string] => [d.id, d.name]),
    ]),
    membersByEmail,
  });
}

/**
 * Org members keyed by lowercased email, for joining check rows to people.
 *
 * A member is keyed by every email that identifies them here — their sign-in
 * address and, when they linked an account on *this* provider, that address
 * too. Both come from `memberIdentityEmails`, the same helper the People page
 * matches access with, so the two features agree on who a person is.
 */
async function loadMembersByEmail({
  organizationId,
  slug,
}: {
  organizationId: string;
  slug: string;
}): Promise<MemberByEmail> {
  const members = await db.member.findMany({
    where: { organizationId },
    select: {
      id: true,
      deactivated: true,
      externalUserId: true,
      externalUserSource: true,
      user: { select: { name: true, email: true, image: true } },
    },
  });

  const byEmail = new Map<
    string,
    NonNullable<VendorIntegrationUser['member']>
  >();
  const identities = members.map((member) => ({
    member,
    ...memberIdentityEmails(member, { source: slug }),
  }));

  const toPerson = (
    member: (typeof members)[number],
    email: string,
  ): NonNullable<VendorIntegrationUser['member']> => ({
    id: member.id,
    name: member.user.name,
    email,
    image: member.user.image,
    deactivated: member.deactivated,
  });

  // Sign-in addresses first, so a linked alias can never shadow the person who
  // actually owns that address here.
  for (const { member, email } of identities) {
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, toPerson(member, email));
  }

  for (const { member, email, linked } of identities) {
    if (!email || !linked || byEmail.has(linked)) continue;
    byEmail.set(linked, toPerson(member, email));
  }
  return byEmail;
}
