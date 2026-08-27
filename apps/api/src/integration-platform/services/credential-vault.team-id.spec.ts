jest.mock('@db', () => ({
  db: {},
}));

import { CredentialVaultService } from './credential-vault.service';
import { CredentialRepository } from '../repositories/credential.repository';
import { ConnectionRepository } from '../repositories/connection.repository';
import type { IntegrationConnection, IntegrationCredentialVersion } from '@db';

const encrypted = (value: string) => ({
  encrypted: value,
  iv: 'iv',
  tag: 'tag',
  salt: 'salt',
});

const makeConnection = (): IntegrationConnection => ({
  id: 'conn_1',
  providerId: 'prv_1',
  organizationId: 'org_1',
  status: 'active',
  authStrategy: 'oauth2',
  activeCredentialVersionId: 'cred_1',
  lastSyncAt: null,
  nextSyncAt: null,
  syncCadence: null,
  metadata: {},
  variables: {},
  errorMessage: null,
  refreshLeaseUntil: null,
  refreshLeaseToken: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
});

const makeCredentialVersion = (): IntegrationCredentialVersion => ({
  id: 'cred_1',
  connectionId: 'conn_1',
  encryptedPayload: {},
  version: 1,
  expiresAt: null,
  rotatedAt: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const buildService = () => {
  const credentialRepository = new CredentialRepository();
  const connectionRepository = new ConnectionRepository();
  const createSpy = jest
    .spyOn(credentialRepository, 'create')
    .mockResolvedValue(makeCredentialVersion());
  jest.spyOn(credentialRepository, 'deleteOldVersions').mockResolvedValue(0);
  jest.spyOn(connectionRepository, 'update').mockResolvedValue(makeConnection());
  const service = new CredentialVaultService(
    credentialRepository,
    connectionRepository,
  );
  jest
    .spyOn(service, 'encrypt')
    .mockImplementation(async (value) => encrypted(value));
  return { service, createSpy };
};

/**
 * `encryptedPayload` is typed as `object` on the repository input, so reads of
 * individual fields need narrowing. A typed accessor keeps the assertions
 * readable without casting the whole payload.
 */
const payloadField = (payload: object, key: string): unknown =>
  (payload as Record<string, unknown>)[key];

describe('CredentialVaultService account-scoped team_id handling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('captures team_id from a Vercel token response so checks can scope requests', async () => {
    const { service, createSpy } = buildService();
    jest.spyOn(service, 'getDecryptedCredentials').mockResolvedValue({});

    await service.storeOAuthTokens('conn_1', {
      access_token: 'vercel-access',
      token_type: 'Bearer',
      team_id: 'team_abc',
    });

    const createInput = createSpy.mock.calls[0]?.[0];
    if (!createInput) throw new Error('Expected credential version to be created');

    // Plaintext, like api_domain: the check runtime reads it as
    // ctx.credentials.team_id and adds it to every team-scoped request.
    // Without it Vercel answers team reads in the personal scope and 404s.
    expect(payloadField(createInput.encryptedPayload, 'team_id')).toBe('team_abc');
    expect(payloadField(createInput.encryptedPayload, 'access_token')).toEqual(
      encrypted('vercel-access'),
    );
  });

  it('costs no extra credential read for providers that never send a team', async () => {
    const { service, createSpy } = buildService();
    const getCredsSpy = jest
      .spyOn(service, 'getDecryptedCredentials')
      .mockResolvedValue({});

    await service.storeOAuthTokens('conn_1', {
      access_token: 'github-access',
      refresh_token: 'github-refresh',
      token_type: 'Bearer',
      api_domain: 'https://api.example.com',
    });

    const createInput = createSpy.mock.calls[0]?.[0];
    if (!createInput) throw new Error('Expected credential version to be created');

    expect(payloadField(createInput.encryptedPayload, 'team_id')).toBeUndefined();
    // team_id is not carried forward, so it must not trigger a decrypt of the
    // prior version on the token writes of every other provider.
    expect(getCredsSpy).not.toHaveBeenCalled();
  });

  it('stores nothing for a personal-account install, where Vercel sends no team', async () => {
    const { service, createSpy } = buildService();
    jest.spyOn(service, 'getDecryptedCredentials').mockResolvedValue({});

    await service.storeOAuthTokens('conn_1', {
      access_token: 'personal-access',
      token_type: 'Bearer',
    });

    const createInput = createSpy.mock.calls[0]?.[0];
    if (!createInput) throw new Error('Expected credential version to be created');

    expect(payloadField(createInput.encryptedPayload, 'team_id')).toBeUndefined();
  });
});
