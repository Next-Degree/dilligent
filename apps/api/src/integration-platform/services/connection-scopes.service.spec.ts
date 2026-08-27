jest.mock('@db', () => ({ db: {} }));

import { ConnectionScopesService } from './connection-scopes.service';

const REQUIRED = [
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.security',
];

jest.mock('@trycompai/integration-platform', () => ({
  getManifest: (slug: string) =>
    slug === 'google-workspace'
      ? {
          auth: {
            type: 'oauth2',
            config: {
              scopes: [
                'https://www.googleapis.com/auth/admin.directory.user.readonly',
                'https://www.googleapis.com/auth/admin.directory.user.security',
              ],
            },
          },
        }
      : undefined,
}));

type Credentials = Record<string, string | string[]> | null;

function makeService(credentials: Credentials, providerSlug = 'google-workspace') {
  const connectionRepository = {
    findById: jest.fn().mockResolvedValue({
      id: 'icn_1',
      provider: { slug: providerSlug },
    }),
  };
  const credentialVaultService = {
    getDecryptedCredentials: jest.fn().mockResolvedValue(credentials),
  };

  const service = new ConnectionScopesService(
    connectionRepository as never,
    credentialVaultService as never,
  );

  return { service, connectionRepository, credentialVaultService };
}

describe('ConnectionScopesService', () => {
  it('reports granted when the connection holds every required scope', async () => {
    const { service } = makeService({ scope: REQUIRED.join(' ') });

    const status = await service.getScopeStatus('icn_1');

    expect(status.status).toBe('granted');
    expect(status.missingScopes).toEqual([]);
    expect(status.reconnectRequired).toBe(false);
  });

  it('reports the missing scope and asks for a reconnect', async () => {
    const { service } = makeService({ scope: REQUIRED[0] });

    const status = await service.getScopeStatus('icn_1');

    expect(status.status).toBe('missing');
    expect(status.missingScopes).toEqual([REQUIRED[1]]);
    expect(status.reconnectRequired).toBe(true);
  });

  it('reports unknown, not missing, when no scope was ever recorded', async () => {
    // Connections predating scope persistence would otherwise nag every long-lived
    // customer into a reconnect they may not need.
    const { service } = makeService({ access_token: 'tok' });

    const status = await service.getScopeStatus('icn_1');

    expect(status.status).toBe('unknown');
    expect(status.missingScopes).toEqual([]);
    expect(status.reconnectRequired).toBe(false);
  });

  it('treats an empty scope string as unknown rather than as an empty grant', async () => {
    const { service } = makeService({ scope: '   ' });

    expect((await service.getScopeStatus('icn_1')).status).toBe('unknown');
  });

  it('splits the space-delimited grant the OAuth spec defines', async () => {
    const { service } = makeService({ scope: `${REQUIRED[0]}  ${REQUIRED[1]}` });

    expect((await service.getScopeStatus('icn_1')).grantedScopes).toEqual(REQUIRED);
  });

  describe('hasScope', () => {
    it('is true when the scope is present', async () => {
      const { service } = makeService({ scope: REQUIRED.join(' ') });

      expect(await service.hasScope('icn_1', REQUIRED[1])).toBe(true);
    });

    it('is false when the scope is absent from a known grant', async () => {
      const { service } = makeService({ scope: REQUIRED[0] });

      expect(await service.hasScope('icn_1', REQUIRED[1])).toBe(false);
    });

    it('is true for an unknown grant, so unrecorded scopes do not block work', async () => {
      const { service } = makeService(null);

      expect(await service.hasScope('icn_1', REQUIRED[1])).toBe(true);
    });
  });
});
