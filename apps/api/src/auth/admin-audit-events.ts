/**
 * better-auth admin endpoints recorded in the audit log by the `after` hook in
 * auth.server.ts, keyed by path. better-auth-routes.test.ts checks every path
 * still exists in the installed better-auth.
 */
export const ADMIN_AUDIT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  '/admin/impersonate-user': 'Impersonated a user',
  '/admin/stop-impersonating': 'Stopped impersonating a user',
  '/admin/ban-user': 'Banned a user',
  '/admin/unban-user': 'Unbanned a user',
  '/admin/set-role': 'Changed a user role',
  '/admin/set-user-password': 'Reset a user password',
  '/admin/create-user': 'Created a user',
  '/admin/update-user': 'Updated a user',
  '/admin/remove-user': 'Removed a user',
  '/admin/revoke-user-session': 'Revoked a user session',
  '/admin/revoke-user-sessions': 'Revoked all user sessions',
};
