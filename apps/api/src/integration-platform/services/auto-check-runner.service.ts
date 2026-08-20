import { Injectable, Logger } from '@nestjs/common';
import { tasks } from '@trigger.dev/sdk';
import { getManifest } from '@trycompai/integration-platform';
import { ConnectionRepository } from '../repositories/connection.repository';
import { ProviderRepository } from '../repositories/provider.repository';

@Injectable()
export class AutoCheckRunnerService {
  private readonly logger = new Logger(AutoCheckRunnerService.name);

  constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly providerRepository: ProviderRepository,
  ) {}

  /**
   * Determine if a connection can auto-run checks based on:
   * 1. The provider has checks defined
   * 2. All required variables are configured (or there are no required variables)
   */
  async canAutoRunChecks(connectionId: string): Promise<{
    canRun: boolean;
    reason?: string;
  }> {
    const connection = await this.connectionRepository.findById(connectionId);
    if (!connection) {
      return { canRun: false, reason: 'Connection not found' };
    }

    const provider = await this.providerRepository.findById(
      connection.providerId,
    );
    if (!provider) {
      return { canRun: false, reason: 'Provider not found' };
    }

    const manifest = getManifest(provider.slug);
    if (!manifest) {
      return { canRun: false, reason: 'Manifest not found' };
    }

    // Check if the provider has any checks
    if (!manifest.checks || manifest.checks.length === 0) {
      return { canRun: false, reason: 'No checks defined for this provider' };
    }

    // Collect all required variables (manifest-level and check-level)
    const requiredVariables = new Set<string>();

    // Manifest-level variables
    for (const variable of manifest.variables || []) {
      if (variable.required) {
        requiredVariables.add(variable.id);
      }
    }

    // Check-level variables
    for (const check of manifest.checks) {
      if (check.variables) {
        for (const variable of check.variables) {
          if (variable.required) {
            requiredVariables.add(variable.id);
          }
        }
      }
    }

    // Check if all required variables are configured
    const configuredVariables =
      (connection.variables as Record<string, unknown>) || {};
    const missingVariables: string[] = [];

    for (const requiredVar of requiredVariables) {
      const value = configuredVariables[requiredVar];
      // Check for empty values
      if (value === undefined || value === null || value === '') {
        missingVariables.push(requiredVar);
      }
      // Check for empty arrays
      if (Array.isArray(value) && value.length === 0) {
        missingVariables.push(requiredVar);
      }
    }

    if (missingVariables.length > 0) {
      return {
        canRun: false,
        reason: `Missing required variables: ${missingVariables.join(', ')}`,
      };
    }

    return { canRun: true };
  }

  /**
   * Auto-run checks for a connection if conditions are met.
   * Triggers a Trigger.dev task for reliable background execution.
   * Returns true if the task was triggered, false otherwise.
   */
  async tryAutoRunChecks(connectionId: string): Promise<boolean> {
    const connection = await this.connectionRepository.findById(connectionId);
    if (!connection) {
      this.logger.warn(`Connection ${connectionId} not found`);
      return false;
    }

    const provider = await this.providerRepository.findById(
      connection.providerId,
    );
    if (!provider) {
      this.logger.warn(`Provider not found for connection ${connectionId}`);
      return false;
    }

    const { canRun, reason } = await this.canAutoRunChecks(connectionId);

    if (!canRun) {
      this.logger.log(
        `Skipping auto-run for connection ${connectionId}: ${reason}`,
      );
      return false;
    }

    try {
      // Trigger the Trigger.dev task for reliable background execution
      const handle = await tasks.trigger('run-connection-checks', {
        connectionId,
        organizationId: connection.organizationId,
        providerSlug: provider.slug,
      });

      this.logger.log(
        `Triggered auto-run checks for ${provider.slug} (task: ${handle.id})`,
      );

      await this.tryDispatchVendorDiscovery({
        connectionId,
        organizationId: connection.organizationId,
        providerSlug: provider.slug,
      });

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to trigger auto-run checks for ${connectionId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Kick off vendor discovery when a Google Workspace connection is established, so a
   * freshly-connected organization sees its app inventory now rather than at the next
   * 08:00 schedule.
   *
   * Dispatched separately from the run above because that path persists results under
   * `checkId: 'all'`, and the results reader filters on the exact check id — so discovery
   * results written by it would be invisible to the feature that needs them.
   *
   * Failure here never fails the connection: discovery is additive, and the schedule will
   * pick it up regardless.
   */
  private async tryDispatchVendorDiscovery({
    connectionId,
    organizationId,
    providerSlug,
  }: {
    connectionId: string;
    organizationId: string;
    providerSlug: string;
  }): Promise<void> {
    if (providerSlug !== 'google-workspace') {
      return;
    }

    try {
      const handle = await tasks.trigger('run-vendor-discovery', {
        connectionId,
        organizationId,
      });
      this.logger.log(`Triggered vendor discovery on connect (task: ${handle.id})`);
    } catch (error) {
      this.logger.warn(
        `Could not trigger vendor discovery for ${connectionId}; the daily schedule will retry: ${String(error)}`,
      );
    }
  }
}
