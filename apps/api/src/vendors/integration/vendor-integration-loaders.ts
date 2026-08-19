import { db } from '@db';
import { getManifest } from '@trycompai/integration-platform';
import type { CheckResultsService } from '../../integration-platform/services/check-results.service';
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
export async function loadIntegrationChecks({
  checkResults,
  organizationId,
  connectionId,
  slug,
}: ConnectedIntegration): Promise<VendorIntegrationCheck[]> {
  const runs = await checkResults.getLatestRunSummariesByConnection({
    organizationId,
    connectionId,
  });
  const runsByCheckId = new Map(runs.map((run) => [run.checkId, run]));

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
  ).map((definition) => ({
    checkId: definition.id,
    name: definition.name,
    description: definition.description,
    taskMapping: definition.taskMapping ?? null,
    lastRun: toLastRun(runsByCheckId.get(definition.id)),
  }));

  // A run whose check has since been renamed or removed from the manifest still
  // happened — surface it from the run's own denormalized name rather than
  // dropping evidence the customer can see elsewhere.
  const known = new Set(checks.map((check) => check.checkId));
  for (const run of runs) {
    if (known.has(run.checkId)) continue;
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
}: ConnectedIntegration): Promise<VendorIntegrationUser[]> {
  const definitions = getManifest(slug)?.checks ?? [];
  if (definitions.length === 0) return [];

  const perCheck = await Promise.all(
    definitions.map(async (definition) => {
      const rows = await checkResults.getLatestResultsByCheck({
        organizationId,
        connectionId,
        checkId: definition.id,
        resourceType: USER_RESOURCE_TYPE,
      });
      return rows.map<TaggedCheckResultRow>((row) => ({
        ...row,
        checkId: definition.id,
      }));
    }),
  );
  const results = perCheck.flat();
  if (results.length === 0) return [];

  return toVendorIntegrationUsers({
    results,
    checkNamesById: new Map(
      definitions.map((definition) => [definition.id, definition.name]),
    ),
    membersByEmail: await loadMembersByEmail(organizationId),
  });
}

/** Org members keyed by lowercased email, for joining check rows to people. */
async function loadMembersByEmail(
  organizationId: string,
): Promise<MemberByEmail> {
  const members = await db.member.findMany({
    where: { organizationId },
    select: {
      id: true,
      deactivated: true,
      user: { select: { name: true, email: true, image: true } },
    },
  });

  const byEmail = new Map<
    string,
    NonNullable<VendorIntegrationUser['member']>
  >();
  for (const member of members) {
    const email = member.user.email.trim().toLowerCase();
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, {
      id: member.id,
      name: member.user.name,
      email,
      image: member.user.image,
      deactivated: member.deactivated,
    });
  }
  return byEmail;
}
