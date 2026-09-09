import { db } from '@db';
import type { Prisma } from '@db';
import {
  isExternallyHostedVendor,
  migrateLegacyVendorCategory,
} from '@trycompai/utils/vendors';
import { parseStoredAnswers } from '../wizard/wizard-schema';
import { fingerprintParties, fingerprintRiskTreatment } from './fingerprints';
import type { IsmsPlatformData } from './types';

const HIGH_LIKELIHOOD = ['likely', 'very_likely'];
const HIGH_IMPACT = ['major', 'severe'];

/**
 * Reads all platform data used to derive the ISMS foundational documents for a
 * single organization. Always scoped by organizationId. The returned shape is
 * the raw snapshot — derivation logic lives in the per-document handlers so this
 * file only owns the queries.
 */
export async function collectPlatformData({
  organizationId,
  frameworkId,
  client,
}: {
  organizationId: string;
  frameworkId: string;
  /**
   * Optional transaction client. The approval flow passes its transaction so
   * the drift baseline is read at the SAME point in time as the rows frozen
   * into the published version — otherwise a concurrent edit between the two
   * reads makes a just-approved document immediately show as stale.
   */
  client?: Prisma.TransactionClient;
}): Promise<IsmsPlatformData> {
  const dbc = client ?? db;
  const [
    organization,
    frameworkInstances,
    vendors,
    memberCount,
    membersGrouped,
    deviceCount,
    risks,
    trainingCompletionCount,
    ownFramework,
    profile,
    partiesRows,
    acceptanceRows,
  ] = await Promise.all([
    dbc.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
    dbc.frameworkInstance.findMany({
      where: { organizationId },
      select: { framework: { select: { name: true } } },
    }),
    dbc.vendor.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        category: true,
        // Delivery — not category — is what decides whether a vendor runs outside our
        // perimeter, so ISMS scoping reads it directly.
        deliveryModels: true,
        isSubProcessor: true,
        // Risk fields feed the Risk Treatment Plan fingerprint (6.1.3).
        status: true,
        inherentProbability: true,
        inherentImpact: true,
        residualProbability: true,
        residualImpact: true,
        treatmentStrategy: true,
        treatmentStrategyDescription: true,
        assigneeId: true,
        assignee: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    dbc.member.count({ where: { organizationId, deactivated: false } }),
    dbc.member.groupBy({
      by: ['department'],
      where: { organizationId, deactivated: false },
      _count: { _all: true },
    }),
    dbc.device.count({ where: { organizationId } }),
    dbc.risk.findMany({
      where: { organizationId },
      select: {
        id: true,
        residualLikelihood: true,
        residualImpact: true,
        // The remaining fields feed the Risk Treatment Plan fingerprint (6.1.3).
        title: true,
        category: true,
        status: true,
        likelihood: true,
        impact: true,
        treatmentStrategy: true,
        treatmentStrategyDescription: true,
        assigneeId: true,
        assignee: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    dbc.employeeTrainingVideoCompletion.count({
      where: { member: { organizationId } },
    }),
    dbc.frameworkEditorFramework.findUnique({
      where: { id: frameworkId },
      select: { name: true },
    }),
    dbc.ismsProfile.findUnique({
      where: { organizationId_frameworkId: { organizationId, frameworkId } },
      select: { answers: true },
    }),
    dbc.ismsInterestedParty.findMany({
      where: {
        document: {
          organizationId,
          frameworkId,
          type: 'interested_parties_register',
        },
      },
      select: { id: true, name: true, category: true },
    }),
    dbc.riskAcceptance.findMany({
      where: { organizationId },
      select: { id: true, riskId: true, vendorId: true },
    }),
  ]);

  const frameworkNames = new Set<string>();
  for (const instance of frameworkInstances) {
    if (instance.framework?.name) frameworkNames.add(instance.framework.name);
  }
  if (ownFramework?.name) frameworkNames.add(ownFramework.name);

  const vendorsByCategory: Record<string, number> = {};
  const subProcessorNames: string[] = [];
  const infraVendorNames: string[] = [];
  for (const vendor of vendors) {
    // Keyed by the MIGRATED category: a row the backfill has not reached would
    // otherwise count under `cloud` while its backfilled neighbours count under
    // `cloud_infrastructure`, splitting one category across two buckets and
    // reporting drift when the row later moves between them.
    const { category } = migrateLegacyVendorCategory(vendor.category);
    vendorsByCategory[category] = (vendorsByCategory[category] ?? 0) + 1;
    if (vendor.isSubProcessor) subProcessorNames.push(vendor.name);
    if (isExternallyHostedVendor(vendor)) infraVendorNames.push(vendor.name);
  }

  const membersByDepartment: Record<string, number> = {};
  for (const row of membersGrouped) {
    membersByDepartment[row.department] = row._count._all;
  }

  const highRiskCount = risks.filter(
    (risk) =>
      HIGH_LIKELIHOOD.includes(risk.residualLikelihood) &&
      HIGH_IMPACT.includes(risk.residualImpact),
  ).length;

  return {
    organizationName: organization?.name?.trim() || 'The organization',
    frameworkNames: Array.from(frameworkNames).sort(),
    vendorCount: vendors.length,
    subProcessorCount: subProcessorNames.length,
    vendorsByCategory,
    subProcessorNames: subProcessorNames.sort(),
    infraVendorNames: infraVendorNames.sort(),
    memberCount,
    membersByDepartment,
    deviceCount,
    riskCount: risks.length,
    highRiskCount,
    hasTrainingProgram: trainingCompletionCount > 0,
    wizardAnswers: parseStoredAnswers(profile?.answers),
    partiesFingerprint: fingerprintParties(partiesRows),
    riskTreatmentFingerprint: fingerprintRiskTreatment({
      risks,
      vendors,
      acceptances: acceptanceRows,
    }),
  };
}
