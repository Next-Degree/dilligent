/**
 * Manifest scopes that a stored scope override would drop.
 *
 * Custom scopes *replace* the manifest list rather than union with it (see
 * `oauth-credentials.service.ts`), so adding a scope to a manifest is a silent no-op for any
 * deployment that has configured an override: the new permission is never requested, and the
 * check that needs it fails with a permissions error nobody can trace back to this decision.
 *
 * Returns an empty array when there is no override, or when the override already covers every
 * manifest scope.
 */
export function findScopesDroppedByOverride({
  configuredScopes,
  manifestScopes,
}: {
  configuredScopes: string[];
  manifestScopes: string[];
}): string[] {
  if (configuredScopes.length === 0) {
    return [];
  }

  const configured = new Set(configuredScopes);
  return manifestScopes.filter((scope) => !configured.has(scope));
}

/** Operator-facing warning naming the scopes an override drops and why it matters. */
export function scopeOverrideWarning({
  providerSlug,
  source,
  droppedScopes,
}: {
  providerSlug: string;
  source: 'organization' | 'platform';
  droppedScopes: string[];
}): string {
  return (
    `${source} OAuth scope override for "${providerSlug}" omits ${droppedScopes.length} ` +
    `manifest scope(s): ${droppedScopes.join(', ')}. Custom scopes replace the manifest list ` +
    'rather than extend it, so checks needing these scopes will fail until the override is ' +
    'updated.'
  );
}
