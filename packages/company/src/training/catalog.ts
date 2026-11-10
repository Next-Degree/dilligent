import { TRAINING_VALIDITY_DAYS } from './constants';
import { CCPA_FRAMEWORK_NAME, HIPAA_FRAMEWORK_NAME } from './frameworks';
import {
  CCPA_TRAINING_VIDEO_IDS,
  GENERAL_TRAINING_VIDEO_IDS,
  HIPAA_TRAINING_ID,
  type CcpaTrainingVideoId,
  type TrainingVideoId,
} from './ids';

export type TrainingGroupId = 'general' | 'hipaa' | 'ccpa';

/** Every module the catalog knows about, including ones not yet accepted by the write paths. */
export type CatalogModuleId = TrainingVideoId | CcpaTrainingVideoId;

/** When an organization's members must take a training group. */
export type TrainingEligibility =
  | { kind: 'org-setting'; setting: 'securityTrainingStepEnabled' }
  | { kind: 'framework'; frameworkName: string };

/**
 * A training an employee takes as one unit: its modules are completed
 * together, and renewed together every `cadenceDays`.
 */
export interface TrainingGroup {
  id: TrainingGroupId;
  title: string;
  moduleIds: readonly CatalogModuleId[];
  cadenceDays: number;
  eligibility: TrainingEligibility;
}

export const TRAINING_GROUPS: readonly TrainingGroup[] = [
  {
    id: 'general',
    title: 'Security Awareness Training',
    moduleIds: GENERAL_TRAINING_VIDEO_IDS,
    cadenceDays: TRAINING_VALIDITY_DAYS,
    eligibility: { kind: 'org-setting', setting: 'securityTrainingStepEnabled' },
  },
  {
    id: 'hipaa',
    title: 'HIPAA Security Awareness Training',
    moduleIds: [HIPAA_TRAINING_ID],
    cadenceDays: TRAINING_VALIDITY_DAYS,
    eligibility: { kind: 'framework', frameworkName: HIPAA_FRAMEWORK_NAME },
  },
  {
    id: 'ccpa',
    title: 'CCPA Privacy Training',
    moduleIds: CCPA_TRAINING_VIDEO_IDS,
    cadenceDays: TRAINING_VALIDITY_DAYS,
    eligibility: { kind: 'framework', frameworkName: CCPA_FRAMEWORK_NAME },
  },
];

export function getTrainingGroup(id: TrainingGroupId): TrainingGroup {
  const group = TRAINING_GROUPS.find((candidate) => candidate.id === id);
  if (!group) {
    throw new Error(`Unknown training group: ${id}`);
  }
  return group;
}

export function groupForModule(moduleId: string): TrainingGroup | undefined {
  return TRAINING_GROUPS.find((group) => (group.moduleIds as readonly string[]).includes(moduleId));
}

/**
 * The training groups an organization's members must take, given its security
 * training toggle and the names of the frameworks it has enabled.
 */
export function requiredTrainingGroups({
  securityTrainingStepEnabled,
  frameworkNames,
}: {
  securityTrainingStepEnabled: boolean;
  frameworkNames: readonly string[];
}): TrainingGroup[] {
  return TRAINING_GROUPS.filter((group) => {
    if (group.eligibility.kind === 'org-setting') return securityTrainingStepEnabled;
    return frameworkNames.includes(group.eligibility.frameworkName);
  });
}
