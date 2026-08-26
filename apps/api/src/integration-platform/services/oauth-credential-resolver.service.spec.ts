jest.mock('@db', () => ({ db: {} }));

import { OAuthCredentialResolver } from './oauth-credential-resolver.service';
import {
  UnusableOAuthCredentialsError,
  type StoredOAuthClientRecord,
} from './oauth-credentials.types';

const MANIFEST_SCOPES = ['scope.read', 'scope.security'];

const oauthConfig = { scopes: MANIFEST_SCOPES } as never;

function makeResolver(decrypt: jest.Mock) {
  const credentialVaultService = { decrypt };
  return new OAuthCredentialResolver(credentialVaultService as never);
}

function record(
  overrides: Partial<StoredOAuthClientRecord> = {},
): StoredOAuthClientRecord {
  return {
    encryptedClientId: { encrypted: 'id' },
    encryptedClientSecret: { encrypted: 'secret' },
    customScopes: [],
    ...overrides,
  };
}

describe('OAuthCredentialResolver', () => {
  it('trims whitespace a stored credential picked up on the way in', async () => {
    const decrypt = jest
      .fn()
      .mockResolvedValueOnce('123-abc.apps.googleusercontent.com\n')
      .mockResolvedValueOnce('  GOCSPX-secret  ');

    const credentials = await makeResolver(decrypt).resolve({
      providerSlug: 'google-workspace',
      source: 'organization',
      record: record(),
      oauthConfig,
    });

    // Untrimmed, this reaches the provider as `client_id=...%0A` and Google answers with
    // its own "Error 401: invalid_client" page.
    expect(credentials.clientId).toBe('123-abc.apps.googleusercontent.com');
    expect(credentials.clientSecret).toBe('GOCSPX-secret');
  });

  it('falls back to manifest scopes when no override is stored', async () => {
    const decrypt = jest.fn().mockResolvedValue('value');

    const credentials = await makeResolver(decrypt).resolve({
      providerSlug: 'google-workspace',
      source: 'platform',
      record: record(),
      oauthConfig,
    });

    expect(credentials.scopes).toEqual(MANIFEST_SCOPES);
    expect(credentials.source).toBe('platform');
  });

  it('uses a stored scope override in place of the manifest scopes', async () => {
    const decrypt = jest.fn().mockResolvedValue('value');

    const credentials = await makeResolver(decrypt).resolve({
      providerSlug: 'google-workspace',
      source: 'organization',
      record: record({ customScopes: ['scope.read'] }),
      oauthConfig,
    });

    expect(credentials.scopes).toEqual(['scope.read']);
  });

  it('throws rather than resolving when the stored client cannot be decrypted', async () => {
    const decrypt = jest.fn().mockRejectedValue(new Error('bad auth tag'));

    await expect(
      makeResolver(decrypt).resolve({
        providerSlug: 'google-workspace',
        source: 'organization',
        record: record(),
        oauthConfig,
      }),
    ).rejects.toBeInstanceOf(UnusableOAuthCredentialsError);
  });

  it('throws when a stored client decrypts to an empty value', async () => {
    const decrypt = jest
      .fn()
      .mockResolvedValueOnce('   ')
      .mockResolvedValueOnce('GOCSPX-secret');

    await expect(
      makeResolver(decrypt).resolve({
        providerSlug: 'google-workspace',
        source: 'platform',
        record: record(),
        oauthConfig,
      }),
    ).rejects.toBeInstanceOf(UnusableOAuthCredentialsError);
  });
});
