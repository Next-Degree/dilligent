import { db } from '@db';
import { getManifest, runCheck } from '@trycompai/integration-platform';
import { logger, schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';
import {
  getAccessToken,
  requestValidCredentials,
} from '../integration-platform/ensure-valid-credentials';

export const DISCOVERY_CHECK_ID = 'oauth-app-access';
export const DISCOVERY_PROVIDER_SLUG = 'google-workspace';
const REQUIRED_TOKENS_SCOPE =
  'https://www.googleapis.com/auth/admin.directory.user.security';

const API_BASE_URL = process.env.BASE_URL || 'http://localhost:3333';

const payloadSchema = z.object({
  connectionId: z.string(),
  organizationId: z.string(),
});

/**
 * Run the third-party app inventory for one connection and materialise the result.
 *
 * Owns its own run persistence rather than reusing the shared check runner, for two reasons:
 * the shared path writes `checkId: 'all'` while the results reader filters on the exact check
 * id — so results written that way are invisible to this feature — and the consent preflight
 * below has to be able to decline to write a run at all.
 */
export const runVendorDiscoveryTask = schemaTask({
  id: 'run-vendor-discovery',
  schema: payloadSchema,
  // One API call per user; a throttled tenant backing off can outlast the usual 15 minutes.
  maxDuration: 1000 * 60 * 30,
  run: async ({ connectionId, organizationId }) => {
    // Emitted before any bail-out so an aborted run is always distinguishable from a run
    // whose task body never started.
    logger.info('Starting vendor discovery', { connectionId, organizationId });

    const connection = await db.integrationConnection.findFirst({
      where: { id: connectionId, organizationId },
      include: { provider: true },
    });

    if (!connection || connection.provider.slug !== DISCOVERY_PROVIDER_SLUG) {
      logger.warn(
        'Vendor discovery skipped: no matching Google Workspace connection',
        {
          connectionId,
        },
      );
      return { success: false, reason: 'connection-not-found' as const };
    }

    const manifest = getManifest(DISCOVERY_PROVIDER_SLUG);
    const check = manifest?.checks?.find((c) => c.id === DISCOVERY_CHECK_ID);
    if (!manifest || !check) {
      logger.error(
        'Vendor discovery skipped: check is not registered in this build',
        {
          providerSlug: DISCOVERY_PROVIDER_SLUG,
          checkId: DISCOVERY_CHECK_ID,
          hasManifest: Boolean(manifest),
        },
      );
      return { success: false, reason: 'check-not-found' as const };
    }

    const credentialResult = await requestValidCredentials({
      apiUrl: API_BASE_URL,
      connectionId,
      organizationId,
    });
    if (!credentialResult.success || !credentialResult.credentials) {
      // `requestValidCredentials` never throws and never logs, so without this the run ends
      // in a second with an empty trace and the actual cause — an unset SERVICE_TOKEN_TRIGGER,
      // a BASE_URL still pointing at localhost, a 401 from the API — is lost entirely.
      logger.error(
        'Vendor discovery blocked: could not obtain valid credentials',
        {
          connectionId,
          apiUrl: API_BASE_URL,
          status: credentialResult.status,
          error: credentialResult.error,
        },
      );
      return {
        success: false,
        reason: 'credentials-unavailable' as const,
        error: credentialResult.error,
      };
    }
    const credentials = credentialResult.credentials;

    // Preflight consent. When the scope was never granted, record NO run: a failed or empty
    // run would become the latest real run for this check, and the results reader would hand
    // the materialiser an empty set, which naive reconciliation reads as "every grant was
    // revoked". Writing nothing leaves yesterday's good run latest, which is the truth.
    const grantedScopes =
      typeof credentials.scope === 'string'
        ? credentials.scope.split(/\s+/)
        : null;
    if (grantedScopes && !grantedScopes.includes(REQUIRED_TOKENS_SCOPE)) {
      logger.warn(
        'Vendor discovery blocked: connection lacks the required scope',
        {
          connectionId,
        },
      );
      await db.integrationConnection.update({
        where: { id: connectionId },
        data: {
          metadata: {
            ...((connection.metadata as Record<string, unknown>) ?? {}),
            vendorDiscoveryBlocked: {
              reason: 'missing-scope',
              missingScopes: [REQUIRED_TOKENS_SCOPE],
              at: new Date().toISOString(),
            },
          },
        },
      });
      return { success: false, reason: 'missing-scope' as const };
    }

    const checkRun = await db.integrationCheckRun.create({
      data: {
        connectionId,
        // The real check id, not 'all' — otherwise these results are unreadable.
        checkId: check.id,
        checkName: check.name,
        status: 'running',
        startedAt: new Date(),
      },
    });

    try {
      const outcome = await runCheck(check, {
        manifest,
        accessToken: getAccessToken(credentials),
        credentials,
        variables:
          (connection.variables as Record<
            string,
            string | number | boolean | string[] | undefined
          >) || {},
        connectionId,
        organizationId,
        logger: {
          info: (msg, data) => logger.info(msg, data),
          warn: (msg, data) => logger.warn(msg, data),
          error: (msg, data) => logger.error(msg, data),
        },
      });

      const results = [
        ...outcome.result.findings.map((finding) => ({
          checkRunId: checkRun.id,
          passed: false,
          title: finding.title,
          description: finding.description || '',
          resourceType: finding.resourceType,
          resourceId: finding.resourceId,
          severity: finding.severity,
          remediation: finding.remediation,
          evidence: JSON.parse(JSON.stringify(finding.evidence || {})),
        })),
        ...outcome.result.passingResults.map((passing) => ({
          checkRunId: checkRun.id,
          passed: true,
          title: passing.title,
          description: passing.description || '',
          resourceType: passing.resourceType,
          resourceId: passing.resourceId,
          severity: 'info' as const,
          remediation: undefined,
          evidence: JSON.parse(JSON.stringify(passing.evidence || {})),
        })),
      ];

      if (results.length > 0) {
        await db.integrationCheckResult.createMany({ data: results });
      }

      await db.integrationCheckRun.update({
        where: { id: checkRun.id },
        data: {
          status: outcome.result.findings.length > 0 ? 'failed' : 'success',
          completedAt: new Date(),
          durationMs: outcome.durationMs,
          totalChecked: 1,
          passedCount: outcome.result.passingResults.length,
          failedCount: outcome.result.findings.length,
        },
      });

      // Materialisation runs through the API so the trust predicate, resolution and writes
      // live in one place rather than being duplicated in the task runtime.
      const response = await fetch(
        `${API_BASE_URL}/v1/internal/vendor-discovery/materialize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-service-token': process.env.SERVICE_TOKEN_TRIGGER ?? '',
            'x-organization-id': organizationId,
          },
          body: JSON.stringify({ organizationId, connectionId }),
        },
      );

      if (!response.ok) {
        logger.error('Vendor discovery materialisation failed', {
          status: response.status,
        });
        return { success: false, reason: 'materialization-failed' as const };
      }

      const summary = (await response.json()) as Record<string, unknown>;
      logger.info('Vendor discovery complete', { connectionId, ...summary });

      return { success: true, checkRunId: checkRun.id, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Vendor discovery check failed', { error: message });

      await db.integrationCheckRun.update({
        where: { id: checkRun.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: message,
        },
      });

      return {
        success: false,
        reason: 'check-failed' as const,
        error: message,
      };
    }
  },
});
