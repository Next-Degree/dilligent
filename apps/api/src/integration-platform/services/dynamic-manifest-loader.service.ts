import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@db';
import {
  registry,
  interpretDeclarativeCheck,
  type IntegrationManifest,
  type IntegrationService,
  type AuthStrategy,
  type IntegrationCategory,
  type IntegrationCapability,
  type FindingSeverity,
  type CheckVariable,
} from '@trycompai/integration-platform';
import {
  DynamicIntegrationRepository,
  type DynamicIntegrationWithChecks,
} from '../repositories/dynamic-integration.repository';
import { buildBasicAuthCredentialFields } from './basic-auth-credential-fields';
import type { DynamicCheck } from '@db';

const BOOT_RETRY_INTERVAL_MS = 60_000;

// Connection-level failures that clear up on their own (DB starting, a
// serverless DB waking from suspend, a dropped connection), so worth retrying.
// P1001 unreachable, P1002 timed out, P1008 operation timed out,
// P1017 server closed the connection, P2024 pool connection timeout.
const TRANSIENT_PRISMA_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
]);
const TRANSIENT_ERROR_MESSAGES = [
  "Can't reach database server",
  'Server has closed the connection',
  'Connection terminated',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
];

@Injectable()
export class DynamicManifestLoaderService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DynamicManifestLoaderService.name);
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private isRetrying = false;

  constructor(
    private readonly dynamicIntegrationRepo: DynamicIntegrationRepository,
  ) {}

  async onModuleInit() {
    try {
      await this.loadDynamicManifests();
      return;
    } catch (error) {
      this.logManifestLoadFailure(error, 'boot');
      // Only an unreachable DB is worth retrying. Any other failure (bad row,
      // schema mismatch) would fail the same way every minute.
      if (!this.isDatabaseUnavailable(error)) return;
    }

    // Retry only until the DB is reachable (e.g. Postgres still starting in
    // local dev). No steady-state polling: it would keep a serverless DB awake,
    // and edits already reload via invalidateCache().
    this.retryTimer = setInterval(() => {
      if (this.isRetrying) return;
      this.isRetrying = true;
      this.loadDynamicManifests()
        .then(() => this.stopRetry())
        .catch((err) => {
          if (this.isDatabaseUnavailable(err)) {
            this.logger.debug(
              'Dynamic manifests skipped: database still unreachable',
            );
            return;
          }
          this.logger.error(
            'Dynamic manifest load failed after DB came online; not retrying',
            err,
          );
          this.stopRetry();
        })
        .finally(() => {
          this.isRetrying = false;
        });
    }, BOOT_RETRY_INTERVAL_MS);
  }

  onModuleDestroy() {
    this.stopRetry();
  }

  private stopRetry() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private isDatabaseUnavailable(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return true;
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      TRANSIENT_PRISMA_CODES.has(error.code)
    ) {
      return true;
    }
    // System-level codes (ECONNREFUSED etc.) only appear in Error.message.
    if (error instanceof Error) {
      return TRANSIENT_ERROR_MESSAGES.some((text) =>
        error.message.includes(text),
      );
    }
    return false;
  }

  private logManifestLoadFailure(error: unknown, phase: 'boot') {
    if (this.isDatabaseUnavailable(error)) {
      this.logger.warn(
        'Dynamic integration manifests not loaded: database unreachable. Start Postgres (e.g. packages/db docker) or set DATABASE_URL. Manifests will load when the DB is reachable.',
      );
      return;
    }
    this.logger.error(`Failed to load dynamic manifests on ${phase}`, error);
  }

  /**
   * Load all active dynamic integrations from DB and merge into the registry.
   */
  async loadDynamicManifests(): Promise<void> {
    const integrations = await this.dynamicIntegrationRepo.findActive();

    const manifests: IntegrationManifest[] = [];

    for (const integration of integrations) {
      try {
        const manifest = this.convertToManifest(integration);
        manifests.push(manifest);
      } catch (error) {
        this.logger.error(
          `Failed to convert dynamic integration "${integration.slug}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    registry.refreshDynamic(manifests);
    this.logger.log(
      `Loaded ${manifests.length} dynamic integrations into registry`,
    );
  }

  /**
   * Invalidate cache — force reload from DB.
   * Call this after creating/updating/deleting dynamic integrations.
   */
  async invalidateCache(): Promise<void> {
    await this.loadDynamicManifests();
  }

  /**
   * Convert a DynamicIntegration (DB row) + checks into an IntegrationManifest.
   */
  private convertToManifest(
    integration: DynamicIntegrationWithChecks,
  ): IntegrationManifest {
    const authConfig = integration.authConfig as Record<string, unknown>;
    const auth: AuthStrategy = {
      type: authConfig.type as AuthStrategy['type'],
      config: authConfig.config as AuthStrategy['config'],
    } as AuthStrategy;

    const checks = integration.checks.map((check) =>
      this.convertCheck(check, integration.slug),
    );

    // Collect manifest-level variables from syncDefinition (if present)
    // These appear in the customer configuration UI (ManageIntegrationDialog)
    const syncDef = integration.syncDefinition as Record<
      string,
      unknown
    > | null;
    const syncVariables = syncDef?.variables as CheckVariable[] | undefined;

    // Basic-auth integrations declare their credential field names (e.g. Fivetran
    // maps Basic auth to api_key/api_secret) but ship no credentialFields. Synthesize
    // them so the connect form labels the inputs correctly and — critically — stores
    // the values under the same keys the runtime reads to build the Basic header.
    const credentialFields =
      auth.type === 'basic'
        ? buildBasicAuthCredentialFields(auth.config)
        : undefined;

    return {
      id: integration.slug,
      name: integration.name,
      description: integration.description,
      category: integration.category as IntegrationCategory,
      logoUrl: integration.logoUrl,
      docsUrl: integration.docsUrl ?? undefined,
      auth,
      baseUrl: integration.baseUrl ?? undefined,
      defaultHeaders:
        (integration.defaultHeaders as Record<string, string>) ?? undefined,
      credentialFields,
      capabilities:
        (integration.capabilities as unknown as IntegrationCapability[]) ?? [
          'checks',
        ],
      supportsMultipleConnections: integration.supportsMultipleConnections,
      variables:
        syncVariables && syncVariables.length > 0 ? syncVariables : undefined,
      services:
        (integration.services as IntegrationService[] | null) ?? undefined,
      checks,
      isActive: integration.isActive,
    };
  }

  /**
   * Convert a DynamicCheck (DB row) into an IntegrationCheck using the DSL interpreter.
   */
  private convertCheck(check: DynamicCheck, _integrationSlug: string) {
    const definition = check.definition as Record<string, unknown>;
    const variables = check.variables as unknown as CheckVariable[] | undefined;

    return interpretDeclarativeCheck({
      id: check.checkSlug,
      name: check.name,
      description: check.description,
      definition: definition as Parameters<
        typeof interpretDeclarativeCheck
      >[0]['definition'],
      taskMapping: check.taskMapping ?? undefined,
      defaultSeverity: (check.defaultSeverity as FindingSeverity) ?? 'medium',
      variables: variables && variables.length > 0 ? variables : undefined,
      service: check.service ?? undefined,
    });
  }
}
