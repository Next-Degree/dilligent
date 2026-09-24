import { Injectable, Logger } from '@nestjs/common';
import { getManifest } from '@trycompai/integration-platform';
import { ConnectionRepository } from '../repositories/connection.repository';
import { CredentialVaultService } from './credential-vault.service';

export interface ConnectionScopeStatus {
  /** Scopes the provider actually granted, as recorded at consent time. */
  grantedScopes: string[];
  /** Scopes the manifest currently asks for. */
  requiredScopes: string[];
  /** Required scopes absent from the grant. Empty when status is `unknown`. */
  missingScopes: string[];
  /**
   * `unknown` when the connection's credentials carry no scope record — they predate scope
   * persistence. Reporting those as `missing` would nag every long-lived connection into a
   * reconnect it may not need, so absence of evidence is reported as such.
   */
  status: 'granted' | 'missing' | 'unknown';
  /** Only ever true for `missing` — never for `unknown`. */
  reconnectRequired: boolean;
}

@Injectable()
export class ConnectionScopesService {
  private readonly logger = new Logger(ConnectionScopesService.name);

  constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly credentialVaultService: CredentialVaultService,
  ) {}

  /**
   * Compare a connection's granted OAuth scopes against what its manifest now requires.
   *
   * Adding a scope to a manifest does not retroactively change existing consents, so a
   * connection made before the addition keeps working for every other check while silently
   * lacking the new permission. This is what turns that into something the UI can show.
   */
  async getScopeStatus(connectionId: string): Promise<ConnectionScopeStatus> {
    const connection = await this.connectionRepository.findById(connectionId);
    // `findById` includes the provider relation but its declared return type does not —
    // same narrowing the teardown service uses.
    const providerSlug = (connection as { provider?: { slug: string } } | null)?.provider
      ?.slug;

    const requiredScopes = providerSlug ? this.requiredScopesFor(providerSlug) : [];
    const grantedScopes = await this.grantedScopesFor(connectionId);

    if (grantedScopes === null) {
      return {
        grantedScopes: [],
        requiredScopes,
        missingScopes: [],
        status: 'unknown',
        reconnectRequired: false,
      };
    }

    const granted = new Set(grantedScopes);
    const missingScopes = requiredScopes.filter((scope) => !granted.has(scope));

    return {
      grantedScopes,
      requiredScopes,
      missingScopes,
      status: missingScopes.length > 0 ? 'missing' : 'granted',
      reconnectRequired: missingScopes.length > 0,
    };
  }

  /** Whether a connection holds a specific scope. `unknown` counts as held — see above. */
  async hasScope(connectionId: string, scope: string): Promise<boolean> {
    const status = await this.getScopeStatus(connectionId);
    if (status.status === 'unknown') {
      return true;
    }
    return status.grantedScopes.includes(scope);
  }

  private requiredScopesFor(providerSlug: string): string[] {
    const manifest = getManifest(providerSlug);
    if (manifest?.auth.type !== 'oauth2') {
      return [];
    }
    return manifest.auth.config.scopes ?? [];
  }

  /** `null` means no scope was ever recorded, which is distinct from an empty grant. */
  private async grantedScopesFor(connectionId: string): Promise<string[] | null> {
    try {
      const credentials =
        await this.credentialVaultService.getDecryptedCredentials(connectionId);
      const scope = credentials?.scope;
      if (typeof scope !== 'string' || scope.trim() === '') {
        return null;
      }
      // OAuth scope grants are a space-delimited string.
      return scope.trim().split(/\s+/);
    } catch (error) {
      this.logger.warn(
        `Could not read granted scopes for connection ${connectionId}: ${String(error)}`,
      );
      return null;
    }
  }
}
