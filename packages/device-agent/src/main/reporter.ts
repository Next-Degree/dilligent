import { AGENT_VERSION, API_ROUTES } from '../shared/constants';
import type { CheckInRequest, CheckInResponse, CheckResult } from '../shared/types';
import { log } from './logger';
import { getApiUrl, getAuth, getAuthEpoch, setAuth } from './store';

export interface ReportResult {
  allSucceeded: boolean;
  isCompliant: boolean;
  /** True if ANY org returned 401 — session has expired */
  sessionExpired: boolean;
  /** True if ALL orgs returned 404 — stored device IDs are stale */
  allDevicesNotFound: boolean;
  /**
   * True if any org failed for a reason that may clear up on its own (network
   * error, 5xx, 429). A 4xx such as one stale device's 404 will not, so it must
   * not trigger a quick retry.
   */
  retryable: boolean;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Sends compliance check results to the NestJS API for ALL registered organizations.
 * The same check results are reported to each org's device record.
 *
 * If the API returns `upgradedSessionToken` on any check-in, the token is persisted
 * via setAuth and used for all subsequent iterations. If persistence fails, the loop
 * aborts immediately to avoid further check-ins with a stale on-disk token.
 */
export async function reportCheckResults(checks: CheckResult[]): Promise<ReportResult> {
  const auth = getAuth();
  if (!auth) {
    log('Cannot report check results: not authenticated', 'ERROR');
    return {
      allSucceeded: false,
      isCompliant: false,
      sessionExpired: false,
      allDevicesNotFound: false,
      retryable: false,
    };
  }

  const apiUrl = getApiUrl();
  const epoch = getAuthEpoch();
  let currentToken = auth.sessionToken;

  let allSucceeded = true;
  let anyNonCompliant = false;
  let sessionExpired = false;
  let notFoundCount = 0;
  let retryable = false;

  for (const org of auth.organizations) {
    const payload: CheckInRequest = {
      deviceId: org.deviceId,
      checks,
      agentVersion: AGENT_VERSION,
    };

    try {
      const response = await fetch(`${apiUrl}${API_ROUTES.CHECK_IN}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log(
          `Check-in failed for ${org.organizationName} (${response.status}): ${errorText}`,
          'ERROR',
        );
        allSucceeded = false;
        if (isRetryableStatus(response.status)) retryable = true;

        if (response.status === 401) {
          log('Session expired — user needs to re-authenticate', 'ERROR');
          sessionExpired = true;
          break; // No point trying other orgs with the same expired token
        }
        if (response.status === 404) {
          notFoundCount++;
        }
        continue;
      }

      const result: CheckInResponse = await response.json();

      if (result.upgradedSessionToken) {
        // Signed out mid-report: persisting would restore the old session.
        if (getAuthEpoch() !== epoch) {
          log('Signed out during check-in, not saving upgraded session token');
          allSucceeded = false;
          break;
        }
        try {
          setAuth({ ...auth, sessionToken: result.upgradedSessionToken });
          currentToken = result.upgradedSessionToken;
          log('Session upgraded to dedicated device-agent session');
        } catch (err) {
          log(`Failed to persist upgraded session token: ${err}`, 'ERROR');
          allSucceeded = false;
          break;
        }
      }

      log(
        `Check-in for ${org.organizationName}: ${result.isCompliant ? 'COMPLIANT' : 'NON-COMPLIANT'}`,
      );

      if (!result.isCompliant) {
        anyNonCompliant = true;
      }
    } catch (error) {
      log(`Failed to report to ${org.organizationName}: ${error}`, 'ERROR');
      allSucceeded = false;
      retryable = true; // network-level failure
    }
  }

  return {
    allSucceeded,
    isCompliant: !anyNonCompliant && allSucceeded,
    sessionExpired,
    allDevicesNotFound: notFoundCount > 0 && notFoundCount === auth.organizations.length,
    retryable,
  };
}
