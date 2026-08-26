jest.mock('@db', () => ({ db: {} }));

jest.mock('@trycompai/integration-platform', () => ({
  getManifest: (slug: string) =>
    slug === 'google-workspace'
      ? {
          auth: {
            type: 'oauth2',
            config: { scopes: ['scope.read', 'scope.security'] },
          },
        }
      : undefined,
}));

import { OAuthCredentialsService } from './oauth-credentials.service';
import { UnusableOAuthCredentialsError } from './oauth-credentials.types';

function makeService({
  orgApp = null,
  platformCred = null,
}: {
  orgApp?: unknown;
  platformCred?: unknown;
} = {}) {
  const oauthAppRepository = {
    findActiveByProviderAndOrg: jest.fn().mockResolvedValue(orgApp),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const platformCredentialRepository = {
    findActiveByProviderSlug: jest.fn().mockResolvedValue(platformCred),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const credentialVaultService = {
    encrypt: jest.fn((value: string) => Promise.resolve({ encrypted: value })),
  };
  const credentialResolver = {
    resolve: jest.fn().mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      scopes: ['scope.read'],
      source: 'platform',
    }),
  };

  const service = new OAuthCredentialsService(
    oauthAppRepository as never,
    platformCredentialRepository as never,
    credentialVaultService as never,
    credentialResolver as never,
  );

  return {
    service,
    oauthAppRepository,
    platformCredentialRepository,
    credentialVaultService,
    credentialResolver,
  };
}

const STORED_ROW = {
  encryptedClientId: { encrypted: 'id' },
  encryptedClientSecret: { encrypted: 'secret' },
  customScopes: [],
};

describe('OAuthCredentialsService.getCredentials', () => {
  it('falls back to the platform client when the org has none configured', async () => {
    const { service, credentialResolver } = makeService({
      platformCred: STORED_ROW,
    });

    const credentials = await service.getCredentials(
      'google-workspace',
      'org_1',
    );

    expect(credentials?.source).toBe('platform');
    expect(credentialResolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'platform' }),
    );
  });

  it('does not fall back to the platform client when the org client is unreadable', async () => {
    const { service, platformCredentialRepository, credentialResolver } =
      makeService({ orgApp: STORED_ROW, platformCred: STORED_ROW });
    credentialResolver.resolve.mockRejectedValueOnce(
      new UnusableOAuthCredentialsError('google-workspace', 'organization'),
    );

    // Falling back here would start the flow through a *different* OAuth client, so the
    // provider rejects a client_id the operator never configured for this org and the
    // error points nowhere near the unreadable row that actually caused it.
    await expect(
      service.getCredentials('google-workspace', 'org_1'),
    ).rejects.toBeInstanceOf(UnusableOAuthCredentialsError);
    expect(
      platformCredentialRepository.findActiveByProviderSlug,
    ).not.toHaveBeenCalled();
  });

  it('returns null when neither source has credentials configured', async () => {
    const { service } = makeService();

    await expect(
      service.getCredentials('google-workspace', 'org_1'),
    ).resolves.toBeNull();
  });
});

describe('OAuthCredentialsService credential saving', () => {
  it('trims pasted whitespace off org credentials before encrypting them', async () => {
    const { service, credentialVaultService } = makeService();

    await service.saveOrgCredentials(
      'google-workspace',
      'org_1',
      '123-abc.apps.googleusercontent.com\n',
      '  GOCSPX-secret ',
    );

    expect(credentialVaultService.encrypt).toHaveBeenNthCalledWith(
      1,
      '123-abc.apps.googleusercontent.com',
    );
    expect(credentialVaultService.encrypt).toHaveBeenNthCalledWith(
      2,
      'GOCSPX-secret',
    );
  });

  it('trims platform credentials and hints them from the trimmed value', async () => {
    const { service, credentialVaultService, platformCredentialRepository } =
      makeService();

    await service.savePlatformCredentials(
      'google-workspace',
      '123-abc.apps.googleusercontent.com\n',
      'GOCSPX-secret\n',
    );

    expect(credentialVaultService.encrypt).toHaveBeenNthCalledWith(
      1,
      '123-abc.apps.googleusercontent.com',
    );
    expect(platformCredentialRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSecretHint: OAuthCredentialsService.maskSecret('GOCSPX-secret'),
      }),
    );
  });
});
