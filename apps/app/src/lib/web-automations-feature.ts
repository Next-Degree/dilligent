import 'server-only';

/**
 * Whether Browser Automations (browser evidence + Settings → Browser
 * connections) are enabled.
 *
 * Normally driven by the PostHog `is-web-automations-enabled` flag. Self-hosted
 * instances that don't run PostHog (so `getFeatureFlags` returns `{}`) can force
 * the feature on with the `ENABLE_WEB_AUTOMATIONS=true` environment variable.
 */
export function isWebAutomationsFeatureEnabled(
  flags: Record<string, string | boolean>,
): boolean {
  if (process.env.ENABLE_WEB_AUTOMATIONS === 'true') return true;
  return (
    flags['is-web-automations-enabled'] === true ||
    flags['is-web-automations-enabled'] === 'true'
  );
}
