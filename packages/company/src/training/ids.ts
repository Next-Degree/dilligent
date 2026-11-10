/**
 * Canonical employee-training identifiers.
 *
 * Training completion has two independent write paths that must stay in
 * agreement:
 *
 *  - `TrainingService.markVideoComplete` (NestJS, RBAC-gated), and
 *  - the portal's `/api/portal/complete-training` route, which authorizes on
 *    session + org membership so employees on custom roles without
 *    `portal:update` can still complete their own training.
 *
 * If the two disagree about which videos exist, or about which orgs may
 * complete HIPAA training, the paths desync — one can create completion
 * records (and trigger certificate artifacts) that the other would reject.
 * Both import from here so there is only one definition to change.
 *
 * This module, like the rest of `training/`, deliberately imports nothing from
 * outside the folder: it must stay free of `@trycompai/db` so client bundles
 * can use it.
 */

/** Security Awareness Training videos every employee must complete. */
export const GENERAL_TRAINING_VIDEO_IDS = ['sat-1', 'sat-2', 'sat-3', 'sat-4', 'sat-5'] as const;

export type GeneralTrainingVideoId = (typeof GENERAL_TRAINING_VIDEO_IDS)[number];

/** HIPAA Security Awareness Training — gated on the org's HIPAA framework. */
export const HIPAA_TRAINING_ID = 'hipaa-sat-1';

/**
 * CCPA Privacy Training videos — gated on the org's CCPA framework.
 *
 * Deliberately NOT part of {@link ALL_TRAINING_VIDEO_IDS} yet: that list drives
 * what both completion write paths accept, and they do not enforce the CCPA
 * framework gate until they are moved onto the catalog. Adding the ids there
 * first would let any org record CCPA completions.
 */
export const CCPA_TRAINING_VIDEO_IDS = ['ccpa-1', 'ccpa-2'] as const;

export type CcpaTrainingVideoId = (typeof CCPA_TRAINING_VIDEO_IDS)[number];

export const ALL_TRAINING_VIDEO_IDS = [...GENERAL_TRAINING_VIDEO_IDS, HIPAA_TRAINING_ID] as const;

export type TrainingVideoId = (typeof ALL_TRAINING_VIDEO_IDS)[number];

export function isTrainingVideoId(videoId: string): videoId is TrainingVideoId {
  return (ALL_TRAINING_VIDEO_IDS as readonly string[]).includes(videoId);
}
