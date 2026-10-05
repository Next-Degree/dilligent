import { getRiskScore } from '@/lib/risk-score';
import {
  interpolatedResidualScore,
  previewResidual,
  suggestedResidual,
} from '@/lib/suggested-residual';
import type { Impact, Likelihood, RiskTreatmentType, TaskStatus } from '@db';

/**
 * Mirrors `currentSeverityScore` in the risks table — projects the vendor's
 * inherent + treatment-strategy + linked-task completion into the same
 * interpolated 1–10 score the Treatment Plan hero shows. Falls back to
 * inherent when there's no linked work or strategy doesn't reduce.
 */
export function currentVendorSeverityScore(vendor: {
  inherentProbability: Likelihood;
  inherentImpact: Impact;
  treatmentStrategy: RiskTreatmentType;
  tasks?: Array<{ status: TaskStatus }>;
}): number {
  const inherent = getRiskScore(vendor.inherentProbability, vendor.inherentImpact);
  const tasks = vendor.tasks ?? [];
  const target = previewResidual({
    inherentLikelihood: vendor.inherentProbability,
    inherentImpact: vendor.inherentImpact,
    strategy: vendor.treatmentStrategy,
    hasLinkedWork: tasks.length > 0,
  });
  const targetScore = getRiskScore(target.likelihood, target.impact).score;
  const completion = suggestedResidual({
    likelihood: vendor.inherentProbability,
    impact: vendor.inherentImpact,
    strategy: vendor.treatmentStrategy,
    tasks,
  }).completion;
  return interpolatedResidualScore({
    inherentScore: inherent.score,
    targetScore,
    completion,
  });
}

/**
 * The residual the user set by hand on the Residual Risk matrix. Unlike
 * `currentVendorSeverityScore`, this ignores strategy and task progress.
 */
export function manualResidualScore(vendor: {
  residualProbability: Likelihood;
  residualImpact: Impact;
}): number {
  return getRiskScore(vendor.residualProbability, vendor.residualImpact).score;
}
