import { Injectable, Logger } from '@nestjs/common';
import { OAuthAppRepository } from '../repositories/oauth-app.repository';
import { PlatformCredentialRepository } from '../repositories/platform-credential.repository';
import { CredentialVaultService } from './credential-vault.service';
import { getManifest, type OAuthConfig } from '@trycompai/integration-platform';
import type { Prisma } from '@db';
import { normalizeOAuthClientCredential } from '../utils/oauth-client-credentials';
import { OAuthCredentialResolver } from './oauth-credential-resolver.service';
import {
  UnusableOAuthCredentialsError,
  type OAuthCredentials,
  type OAuthCredentialsAvailability,
} from './oauth-credentials.types';

export {
  UnusableOAuthCredentialsError,
  type OAuthCredentials,
  type OAuthCredentialsAvailability,
};

@Injectable()
export class OAuthCredentialsService {
  private readonly logger = new Logger(OAuthCredentialsService.name);

  constructor(
    private readonly oauthAppRepository: OAuthAppRepository,
    private readonly platformCredentialRepository: PlatformCredentialRepository,
    private readonly credentialVaultService: CredentialVaultService,
    private readonly credentialResolver: OAuthCredentialResolver,
  ) {}

  /**
   * Get OAuth credentials for a provider, checking org-level first, then platform-level
   */
  async getCredentials(
    providerSlug: string,
    organizationId: string,
  ): Promise<OAuthCredentials | null> {
    const manifest = getManifest(providerSlug);
    if (!manifest || manifest.auth.type !== 'oauth2') {
      return null;
    }

    const oauthConfig = manifest.auth.config;

    // 1. Check for org-level custom credentials first
    const orgCredentials = await this.getOrgCredentials(
      providerSlug,
      organizationId,
      oauthConfig,
    );
    if (orgCredentials) {
      return orgCredentials;
    }

    // 2. Fall back to platform-level credentials (from database)
    const platformCredentials = await this.getPlatformCredentials(
      providerSlug,
      oauthConfig,
    );
    if (platformCredentials) {
      return platformCredentials;
    }

    return null;
  }

  /**
   * Check what credentials are available for a provider
   */
  async checkAvailability(
    providerSlug: string,
    organizationId: string,
  ): Promise<OAuthCredentialsAvailability> {
    const manifest = getManifest(providerSlug);
    if (!manifest || manifest.auth.type !== 'oauth2') {
      return {
        available: false,
        hasOrgCredentials: false,
        hasPlatformCredentials: false,
      };
    }

    const oauthConfig = manifest.auth.config;

    // Check org credentials
    const orgApp = await this.oauthAppRepository.findActiveByProviderAndOrg(
      providerSlug,
      organizationId,
    );
    const hasOrgCredentials = !!orgApp;

    // Check platform credentials (from database)
    const platformCred =
      await this.platformCredentialRepository.findActiveByProviderSlug(
        providerSlug,
      );
    const hasPlatformCredentials = !!platformCred;

    return {
      available: hasOrgCredentials || hasPlatformCredentials,
      hasOrgCredentials,
      hasPlatformCredentials,
      setupInstructions: oauthConfig.setupInstructions,
      createAppUrl: oauthConfig.createAppUrl,
    };
  }

  /**
   * Save custom OAuth app credentials for an organization
   */
  async saveOrgCredentials(
    providerSlug: string,
    organizationId: string,
    clientId: string,
    clientSecret: string,
    customScopes?: string[],
    customSettings?: Prisma.InputJsonValue,
  ): Promise<void> {
    const encryptedClientId = await this.credentialVaultService.encrypt(
      normalizeOAuthClientCredential(clientId),
    );
    const encryptedClientSecret = await this.credentialVaultService.encrypt(
      normalizeOAuthClientCredential(clientSecret),
    );

    await this.oauthAppRepository.upsert({
      providerSlug,
      organizationId,
      encryptedClientId,
      encryptedClientSecret,
      customScopes,
      customSettings: customSettings,
    });

    this.logger.log(
      `Saved custom OAuth credentials for ${providerSlug}, org: ${organizationId}`,
    );
  }

  /**
   * Delete custom OAuth app credentials for an organization
   */
  async deleteOrgCredentials(
    providerSlug: string,
    organizationId: string,
  ): Promise<void> {
    await this.oauthAppRepository.delete(providerSlug, organizationId);
    this.logger.log(
      `Deleted custom OAuth credentials for ${providerSlug}, org: ${organizationId}`,
    );
  }

  static maskSecret(value: string): string {
    if (value.length <= 4) return '\u2022'.repeat(value.length);
    return '\u2022'.repeat(value.length - 4) + value.slice(-4);
  }

  /**
   * Save platform-wide OAuth credentials (admin only)
   */
  async savePlatformCredentials(
    providerSlug: string,
    clientId: string,
    clientSecret: string,
    customScopes?: string[],
    customSettings?: Record<string, unknown>,
    userId?: string,
  ): Promise<void> {
    const normalizedClientId = normalizeOAuthClientCredential(clientId);
    const normalizedClientSecret = normalizeOAuthClientCredential(clientSecret);
    const encryptedClientId =
      await this.credentialVaultService.encrypt(normalizedClientId);
    const encryptedClientSecret = await this.credentialVaultService.encrypt(
      normalizedClientSecret,
    );

    await this.platformCredentialRepository.upsert({
      providerSlug,
      encryptedClientId,
      encryptedClientSecret,
      clientIdHint: OAuthCredentialsService.maskSecret(normalizedClientId),
      clientSecretHint: OAuthCredentialsService.maskSecret(
        normalizedClientSecret,
      ),
      customScopes,
      customSettings: customSettings as Prisma.InputJsonValue | undefined,
      createdById: userId,
    });

    this.logger.log(`Saved platform OAuth credentials for ${providerSlug}`);
  }

  /**
   * Delete platform-wide OAuth credentials (admin only)
   */
  async deletePlatformCredentials(providerSlug: string): Promise<void> {
    await this.platformCredentialRepository.delete(providerSlug);
    this.logger.log(`Deleted platform OAuth credentials for ${providerSlug}`);
  }

  /**
   * Get all platform credentials (for admin UI)
   */
  async getAllPlatformCredentials() {
    return this.platformCredentialRepository.findAll();
  }

  /**
   * Get org-level OAuth credentials.
   *
   * Throws `UnusableOAuthCredentialsError` when a row exists but cannot be read: falling
   * through to the platform client would start the flow with a different OAuth app.
   */
  private async getOrgCredentials(
    providerSlug: string,
    organizationId: string,
    oauthConfig: OAuthConfig,
  ): Promise<OAuthCredentials | null> {
    const orgApp = await this.oauthAppRepository.findActiveByProviderAndOrg(
      providerSlug,
      organizationId,
    );

    if (!orgApp) {
      return null;
    }

    return this.credentialResolver.resolve({
      providerSlug,
      source: 'organization',
      record: orgApp,
      oauthConfig,
    });
  }

  /**
   * Get platform-level OAuth credentials from database
   */
  private async getPlatformCredentials(
    providerSlug: string,
    oauthConfig: OAuthConfig,
  ): Promise<OAuthCredentials | null> {
    const platformCred =
      await this.platformCredentialRepository.findActiveByProviderSlug(
        providerSlug,
      );

    if (!platformCred) {
      return null;
    }

    return this.credentialResolver.resolve({
      providerSlug,
      source: 'platform',
      record: platformCred,
      oauthConfig,
    });
  }
}
