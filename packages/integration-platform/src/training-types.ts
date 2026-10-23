// ============================================================================
// Security Awareness Training Records
// ============================================================================

/**
 * One required training module a person has finished.
 */
export interface TrainingModuleCompletion {
  /** Module ID, e.g. 'sat-1' */
  moduleId: string;
  /** ISO timestamp of when the person finished the module */
  completedAt: string;
}

/**
 * A person who is required to complete security awareness training.
 */
export interface TrainingParticipant {
  /** Member ID */
  id: string;
  /** Primary email, already lowercased and trimmed by the host */
  email: string;
  /** Display name, when known */
  name: string | null;
  /**
   * ISO timestamp of when the person joined: their onboard date when an admin
   * set one, otherwise when they were added to the organization. Anchors the
   * onboarding grace period.
   */
  joinedAt: string;
  /** Finished modules only. Modules not started or not finished are absent. */
  completions: TrainingModuleCompletion[];
}

/**
 * Everything a check needs to evidence security awareness training for one
 * organization.
 */
export interface SecurityAwarenessTrainingRecords {
  /** Modules every participant must finish */
  requiredModuleIds: string[];
  /**
   * Whether the training step is turned on in the employee portal. When it is
   * off, employees are never shown the training, so nobody can complete it.
   */
  portalTrainingEnabled: boolean;
  /**
   * Active people with a compliance obligation: the same population the People
   * dashboard counts toward training completion.
   */
  participants: TrainingParticipant[];
}

/**
 * Host-supplied read access to security awareness training records.
 */
export interface TrainingProvider {
  getSecurityAwarenessTraining: () => Promise<SecurityAwarenessTrainingRecords>;
}
