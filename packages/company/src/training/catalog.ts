import { TRAINING_VALIDITY_DAYS } from './constants';
import {
  CCPA_FRAMEWORK_NAME,
  CCPA_TRAINING_UNAVAILABLE_MESSAGE,
  HIPAA_FRAMEWORK_NAME,
  HIPAA_TRAINING_UNAVAILABLE_MESSAGE,
} from './frameworks';
import {
  CCPA_TRAINING_VIDEO_IDS,
  GENERAL_TRAINING_VIDEO_IDS,
  HIPAA_TRAINING_ID,
  type TrainingVideoId,
} from './ids';

export type TrainingGroupId = 'general' | 'hipaa' | 'ccpa';

/** Every module the catalog knows about. */
export type CatalogModuleId = TrainingVideoId;

/**
 * When an organization's members must take a training group. A framework
 * gated group also cannot be completed by an org without that framework, with
 * `unavailableMessage` as the shared rejection copy.
 */
export type TrainingEligibility =
  | { kind: 'org-setting'; setting: 'securityTrainingStepEnabled' }
  | { kind: 'framework'; frameworkName: string; unavailableMessage: string };

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
    eligibility: {
      kind: 'framework',
      frameworkName: HIPAA_FRAMEWORK_NAME,
      unavailableMessage: HIPAA_TRAINING_UNAVAILABLE_MESSAGE,
    },
  },
  {
    id: 'ccpa',
    title: 'CCPA Privacy Training',
    moduleIds: CCPA_TRAINING_VIDEO_IDS,
    cadenceDays: TRAINING_VALIDITY_DAYS,
    eligibility: {
      kind: 'framework',
      frameworkName: CCPA_FRAMEWORK_NAME,
      unavailableMessage: CCPA_TRAINING_UNAVAILABLE_MESSAGE,
    },
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
 * The framework an organization must have enabled before a module can be
 * completed, or null when the module is not framework gated (or unknown).
 *
 * Both completion write paths use this so they reject exactly the same orgs.
 */
export function frameworkGateForModule(
  moduleId: string,
): { frameworkName: string; unavailableMessage: string } | null {
  const eligibility = groupForModule(moduleId)?.eligibility;
  if (eligibility?.kind !== 'framework') return null;

  return {
    frameworkName: eligibility.frameworkName,
    unavailableMessage: eligibility.unavailableMessage,
  };
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
