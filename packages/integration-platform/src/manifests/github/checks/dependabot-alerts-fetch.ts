/**
 * Alert fetching for the Dependabot check.
 */

import type { CheckContext } from '../../../types';
import type { GitHubDependabotAlert } from '../types';
import type { AlertCounts } from './dependabot-alert-severity';

/**
 * Fetch Dependabot alerts for a repository and calculate counts.
 * Returns null when alerts can't be read (feature off or no permission).
 */
export const fetchDependabotAlerts = async ({
  ctx,
  repoFullName,
}: {
  ctx: CheckContext;
  repoFullName: string;
}): Promise<{ counts: AlertCounts; openAlerts: GitHubDependabotAlert[] } | null> => {
  try {
    // GitHub supports filtering by state: open, fixed, dismissed (no "all")
    const [openAlerts, fixedAlerts, dismissedAlerts] = await Promise.all([
      ctx.fetchWithLinkHeader<GitHubDependabotAlert>(`/repos/${repoFullName}/dependabot/alerts`, {
        params: { state: 'open', per_page: '100' },
      }),
      ctx.fetchWithLinkHeader<GitHubDependabotAlert>(`/repos/${repoFullName}/dependabot/alerts`, {
        params: { state: 'fixed', per_page: '100' },
      }),
      ctx.fetchWithLinkHeader<GitHubDependabotAlert>(`/repos/${repoFullName}/dependabot/alerts`, {
        params: { state: 'dismissed', per_page: '100' },
      }),
    ]);

    const counts: AlertCounts = {
      open: openAlerts.length,
      dismissed: dismissedAlerts.length,
      fixed: fixedAlerts.length,
      total: openAlerts.length + fixedAlerts.length + dismissedAlerts.length,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    };

    for (const alert of openAlerts) {
      const severity = alert.security_vulnerability?.severity ?? 'low';
      counts.bySeverity[severity]++;
    }

    return { counts, openAlerts };
  } catch (error) {
    const errorStr = String(error);
    // 403 usually means Dependabot alerts are not enabled or no permission
    if (errorStr.includes('403') || errorStr.includes('Forbidden')) {
      ctx.log(`Cannot access Dependabot alerts for ${repoFullName} (permission denied)`);
      return null;
    }
    // 400 can mean Dependabot alerts endpoint isn't available for the repo/app
    if (errorStr.includes('400') || errorStr.includes('Bad Request')) {
      ctx.log(`Dependabot alerts not available for ${repoFullName} (feature may not be enabled)`);
      return null;
    }
    ctx.warn(`Failed to fetch Dependabot alerts for ${repoFullName}: ${errorStr}`);
    return null;
  }
};
