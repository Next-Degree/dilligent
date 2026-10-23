import type { AuthStrategyType } from '@trycompai/integration-platform';

type StoredCredentials = Record<string, string | string[]>;

/**
 * Load the credentials a check run executes with.
 *
 * Integrations with `auth.type: 'none'` (built-in checks that read Dilligent's
 * own data) never store credentials, so they get an empty set instead of the
 * vault's `null`, which every run path treats as a broken connection.
 */
export async function loadRunCredentials({
  authType,
  load,
}: {
  /** Undefined when the provider's manifest could not be resolved */
  authType: AuthStrategyType | undefined;
  load: () => Promise<StoredCredentials | null>;
}): Promise<StoredCredentials | null> {
  if (authType === 'none') return {};
  return load();
}
