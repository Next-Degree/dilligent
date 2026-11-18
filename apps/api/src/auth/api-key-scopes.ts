/**
 * better-auth resources that no API endpoint gates with @RequirePermission.
 * better-auth handles them internally for sessions, so API keys can never
 * hold them as scopes.
 */
export const API_KEY_INTERNAL_ONLY_RESOURCES: readonly string[] = [
  'invitation',
  'team',
];
