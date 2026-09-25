const resolveRolePermissions = jest.fn();
const resolveServiceByName = jest.fn();

jest.mock('../auth/app-access', () => ({
  resolveRolePermissions,
  permissionsGrant: (
    permissions: Record<string, string[]>,
    resource: string,
    action: string,
  ) => permissions[resource]?.includes(action) ?? false,
}));
jest.mock('../auth/service-token.config', () => ({ resolveServiceByName }));

import type { AuthContext } from '../auth/types';
import { resolveCallerPermissions } from './inbox-permissions';

function auth(overrides: Partial<AuthContext>): AuthContext {
  return {
    organizationId: 'org_1',
    authType: 'session',
    isApiKey: false,
    isPlatformAdmin: false,
    userRoles: null,
    ...overrides,
  };
}

describe('resolveCallerPermissions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('grants everything to platform admins without resolving roles', async () => {
    const can = await resolveCallerPermissions(auth({ isPlatformAdmin: true }));

    expect(can({ resource: 'vendor', action: 'read' })).toBe(true);
    expect(resolveRolePermissions).not.toHaveBeenCalled();
  });

  it('limits scoped API keys to their scopes', async () => {
    const can = await resolveCallerPermissions(
      auth({
        authType: 'api-key',
        isApiKey: true,
        apiKeyScopes: ['task:read'],
      }),
    );

    expect(can({ resource: 'task', action: 'read' })).toBe(true);
    expect(can({ resource: 'integration', action: 'read' })).toBe(false);
  });

  it('treats legacy empty-scope API keys as full access, like the guard', async () => {
    const can = await resolveCallerPermissions(
      auth({ authType: 'api-key', isApiKey: true, apiKeyScopes: [] }),
    );

    expect(can({ resource: 'integration', action: 'read' })).toBe(true);
  });

  it('limits service tokens to their configured permissions', async () => {
    resolveServiceByName.mockReturnValue({ permissions: ['integration:read'] });

    const can = await resolveCallerPermissions(
      auth({ authType: 'service', isServiceToken: true, serviceName: 'svc' }),
    );

    expect(resolveServiceByName).toHaveBeenCalledWith('svc');
    expect(can({ resource: 'integration', action: 'read' })).toBe(true);
    expect(can({ resource: 'task', action: 'read' })).toBe(false);
  });

  it('denies unknown service tokens everything', async () => {
    resolveServiceByName.mockReturnValue(undefined);

    const can = await resolveCallerPermissions(
      auth({ authType: 'service', isServiceToken: true, serviceName: 'nope' }),
    );

    expect(can({ resource: 'task', action: 'read' })).toBe(false);
  });

  it('resolves session callers from their roles in the organization', async () => {
    resolveRolePermissions.mockResolvedValue({ finding: ['read'] });

    const can = await resolveCallerPermissions(
      auth({ userRoles: ['auditor'] }),
    );

    expect(resolveRolePermissions).toHaveBeenCalledWith('org_1', ['auditor']);
    expect(can({ resource: 'finding', action: 'read' })).toBe(true);
    expect(can({ resource: 'integration', action: 'read' })).toBe(false);
  });

  it('resolves a caller with no roles to no permissions', async () => {
    resolveRolePermissions.mockResolvedValue({});

    const can = await resolveCallerPermissions(auth({ userRoles: null }));

    expect(resolveRolePermissions).toHaveBeenCalledWith('org_1', []);
    expect(can({ resource: 'task', action: 'read' })).toBe(false);
  });
});
