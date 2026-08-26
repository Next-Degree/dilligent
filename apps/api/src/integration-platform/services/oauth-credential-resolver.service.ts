import { Injectable, Logger } from '@nestjs/common';
import type { OAuthConfig } from '@trycompai/integration-platform';
import {
  CredentialVaultService,
  EncryptedData,
} from './credential-vault.service';
import {
  UnusableOAuthCredentialsError,
  type OAuthCredentials,
  type StoredOAuthClientRecord,
} from './oauth-credentials.types';
import { normalizeOAuthClientCredential } from '../utils/oauth-client-credentials';
import {
  findScopesDroppedByOverride,
  scopeOverrideWarning,
} from '../utils/scope-override-warning';

/**
 * Turns a stored OAuth client row into the credentials an authorization flow needs.
 *
 * Org-level and platform-level rows carry the same shape, so both sources share one path —
 * which is what keeps the whitespace normalization and the scope-override warning from
 * being applied to one source and quietly forgotten on the other.
 */
@Injectable()
export class OAuthCredentialResolver {
  private readonly logger = new Logger(OAuthCredentialResolver.name);

  constructor(
    private readonly credentialVaultService: CredentialVaultService,
  ) {}

  async resolve({
    providerSlug,
    source,
    record,
    oauthConfig,
  }: {
    providerSlug: string;
    source: OAuthCredentials['source'];
    record: StoredOAuthClientRecord;
    oauthConfig: OAuthConfig;
  }): Promise<OAuthCredentials> {
    const { clientId, clientSecret } = await this.decryptClient({
      providerSlug,
      source,
      record,
    });

    // Use custom scopes if provided, otherwise fall back to manifest defaults
    const scopes =
      record.customScopes.length > 0 ? record.customScopes : oauthConfig.scopes;

    this.warnOnScopesDroppedByOverride({
      providerSlug,
      source,
      configuredScopes: record.customScopes,
      manifestScopes: oauthConfig.scopes,
    });

    return {
      clientId,
      clientSecret,
      scopes,
      source,
      customSettings:
        (record.customSettings as Record<string, unknown> | undefined) ||
        undefined,
    };
  }

  private async decryptClient({
    providerSlug,
    source,
    record,
  }: {
    providerSlug: string;
    source: OAuthCredentials['source'];
    record: StoredOAuthClientRecord;
  }): Promise<{ clientId: string; clientSecret: string }> {
    let clientId: string;
    let clientSecret: string;

    try {
      // Normalized on read as well as on write, so a credential already stored with a
      // pasted trailing newline is repaired on next use instead of being sent to the
      // provider as a `client_id` it never issued.
      clientId = normalizeOAuthClientCredential(
        await this.credentialVaultService.decrypt(
          record.encryptedClientId as EncryptedData,
        ),
      );
      clientSecret = normalizeOAuthClientCredential(
        await this.credentialVaultService.decrypt(
          record.encryptedClientSecret as EncryptedData,
        ),
      );
    } catch (error) {
      // This used to return null, which sent an org whose credentials could not be read
      // through the *platform* OAuth app instead — a different client_id, and a provider
      // rejection ("invalid_client") pointing nowhere near the real cause.
      this.logger.error(
        `Failed to decrypt ${source} OAuth credentials for ${providerSlug}: ${error}`,
      );
      throw new UnusableOAuthCredentialsError(providerSlug, source);
    }

    if (!clientId || !clientSecret) {
      this.logger.error(
        `Stored ${source} OAuth credentials for ${providerSlug} decrypted to an empty client id or secret`,
      );
      throw new UnusableOAuthCredentialsError(providerSlug, source);
    }

    return { clientId, clientSecret };
  }

  /** Warn when a stored scope override silently drops scopes the manifest asks for. */
  private warnOnScopesDroppedByOverride(args: {
    providerSlug: string;
    source: OAuthCredentials['source'];
    configuredScopes: string[];
    manifestScopes: string[];
  }): void {
    const droppedScopes = findScopesDroppedByOverride(args);
    if (droppedScopes.length === 0) {
      return;
    }
    this.logger.warn(scopeOverrideWarning({ ...args, droppedScopes }));
  }
}
