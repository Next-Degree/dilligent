export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  scopes: string[];
  /** Where the credentials came from */
  source: 'organization' | 'platform';
  /** Provider-specific custom settings (e.g., Rippling app name) */
  customSettings?: Record<string, unknown>;
}

export interface OAuthCredentialsAvailability {
  /** Whether credentials are available (from any source) */
  available: boolean;
  /** Whether org has custom credentials configured */
  hasOrgCredentials: boolean;
  /** Whether platform has credentials configured */
  hasPlatformCredentials: boolean;
  /** Instructions for setting up custom OAuth app (if no credentials available) */
  setupInstructions?: string;
  /** URL to create OAuth app */
  createAppUrl?: string;
}

/**
 * The fields an org-level and a platform-level OAuth client row have in common — enough to
 * decrypt the client and resolve the scopes it should request, without either Prisma model
 * leaking into the resolution path.
 */
export interface StoredOAuthClientRecord {
  encryptedClientId: unknown;
  encryptedClientSecret: unknown;
  customScopes: string[];
  customSettings?: unknown;
}

/**
 * A provider has an OAuth client configured, but it cannot be used — the stored value did
 * not decrypt (typically a rotated `ENCRYPTION_KEY`), or it decrypted to an empty string.
 *
 * This is deliberately distinct from "no credentials configured". Treating the two alike is
 * what let an org with an unreadable client silently start its flow through the platform
 * OAuth app instead, so the provider rejected a `client_id` nobody had configured for it.
 */
export class UnusableOAuthCredentialsError extends Error {
  constructor(
    readonly providerSlug: string,
    readonly source: OAuthCredentials['source'],
  ) {
    super(
      `The ${source} OAuth client configured for "${providerSlug}" could not be read. ` +
        'Re-enter its client ID and secret, then try connecting again.',
    );
    this.name = 'UnusableOAuthCredentialsError';
  }
}
