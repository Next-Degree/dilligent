const dbMock = {
  integrationConnection: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

jest.mock('@db', () => ({ db: dbMock }));

import type { AuthContext } from '../../auth/types';
import { connectionErrorSource } from './connection-error.source';

const ORG = 'org_1';
const UPDATED_AT = new Date('2026-09-23T12:00:00Z');
const AUTH: AuthContext = {
  organizationId: ORG,
  authType: 'session',
  isApiKey: false,
  isPlatformAdmin: false,
  userRoles: ['admin'],
};

function connection(errorMessage: string | null) {
  return {
    id: 'icn_1',
    errorMessage,
    updatedAt: UPDATED_AT,
    provider: { slug: 'github', name: 'GitHub' },
  };
}

describe('connectionErrorSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbMock.integrationConnection.findMany.mockResolvedValue([]);
    dbMock.integrationConnection.count.mockResolvedValue(0);
  });

  it('requires integration:read', () => {
    expect(connectionErrorSource.requires).toEqual([
      { resource: 'integration', action: 'read' },
    ]);
  });

  it('queries only errored connections in the caller organization', async () => {
    await connectionErrorSource.collect({
      organizationId: ORG,
      limit: 5,
      auth: AUTH,
    });

    const { where, take } =
      dbMock.integrationConnection.findMany.mock.calls[0][0];
    expect(where).toEqual({ organizationId: ORG, status: 'error' });
    expect(take).toBe(5);
    expect(dbMock.integrationConnection.count).toHaveBeenCalledWith({ where });
  });

  it('maps an errored connection to a link to its integration page', async () => {
    dbMock.integrationConnection.findMany.mockResolvedValue([
      connection('OAuth token was revoked'),
    ]);
    dbMock.integrationConnection.count.mockResolvedValue(1);

    const result = await connectionErrorSource.collect({
      organizationId: ORG,
      limit: 5,
      auth: AUTH,
    });

    expect(result).toEqual({
      total: 1,
      items: [
        {
          key: 'v1:connection-error:icn_1',
          kind: 'connection-error',
          severity: 'critical',
          title: 'GitHub connection is failing',
          detail: 'OAuth token was revoked',
          path: 'integrations/github',
          occurredAt: UPDATED_AT,
          assigneeMemberId: null,
        },
      ],
    });
  });

  it.each([null, '', '   '])(
    'explains what to do when the error message is %p',
    async (message) => {
      dbMock.integrationConnection.findMany.mockResolvedValue([
        connection(message),
      ]);

      const { items } = await connectionErrorSource.collect({
        organizationId: ORG,
        limit: 5,
        auth: AUTH,
      });

      expect(items[0].detail).toBe(
        'Open the integration to see what went wrong and reconnect it.',
      );
    },
  );

  it('truncates very long error messages', async () => {
    dbMock.integrationConnection.findMany.mockResolvedValue([
      connection('x'.repeat(1000)),
    ]);

    const { items } = await connectionErrorSource.collect({
      organizationId: ORG,
      limit: 5,
      auth: AUTH,
    });

    expect(items[0].detail).toHaveLength(280);
    expect(items[0].detail.endsWith('…')).toBe(true);
  });
});
