import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { HybridAuthGuard } from './hybrid-auth.guard';
import { ApiKeyService } from './api-key.service';

// Mock auth.server — the session resolver the guard uses.
const mockGetSession = jest.fn();
jest.mock('./auth.server', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

// Mock @db — user/member/org lookups the guard performs.
const mockUserFindUnique = jest.fn();
const mockMemberFindMany = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockOrgFindUnique = jest.fn();
jest.mock('@db', () => ({
  db: {
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    member: {
      findMany: (...args: unknown[]) => mockMemberFindMany(...args),
      findFirst: (...args: unknown[]) => mockMemberFindFirst(...args),
    },
    organization: {
      findUnique: (...args: unknown[]) => mockOrgFindUnique(...args),
    },
  },
}));

// Service-token validation is a pure lookup; mock it so tests can present a
// valid token and reach the x-user-id acting-member resolution.
const mockResolveServiceByToken = jest.fn();
jest.mock('./service-token.config', () => ({
  resolveServiceByToken: (...args: unknown[]) =>
    mockResolveServiceByToken(...args),
}));

// Mock @trycompai/auth — api-key.service imports it, and its real module pulls
// in ESM-only better-auth code that Jest cannot load.
jest.mock('@trycompai/auth', () => ({}));

describe('HybridAuthGuard — bearer tokens', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;

  const createContext = (
    headers: Record<string, string>,
  ): { context: ExecutionContext; request: Record<string, unknown> } => {
    const request: Record<string, unknown> = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const forwardedAuthorization = (): string | null => {
    const call: unknown = mockGetSession.mock.calls[0]?.[0];
    if (typeof call !== 'object' || call === null || !('headers' in call)) {
      return null;
    }
    const { headers } = call;
    return headers instanceof Headers ? headers.get('authorization') : null;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        {
          provide: ApiKeyService,
          useValue: { extractApiKey: jest.fn(), validateApiKey: jest.fn() },
        },
        Reflector,
      ],
    }).compile();
    guard = module.get<HybridAuthGuard>(HybridAuthGuard);
    reflector = module.get<Reflector>(Reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
  });

  it('authenticates a bearer session token via better-auth getSession', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'usr_1', email: 'user@example.com' },
      session: { id: 'ses_1', activeOrganizationId: 'org_1' },
    });
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_1',
      role: 'admin',
      department: null,
    });
    const { context, request } = createContext({
      authorization: 'Bearer session_token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(forwardedAuthorization()).toBe('Bearer session_token');
    expect(request.authType).toBe('session');
    expect(request.organizationId).toBe('org_1');
    expect(request.memberId).toBe('mem_1');
  });

  // Hosted-MCP OAuth (Gram) is parked: a bearer token that better-auth does not
  // resolve as a session is a plain 401, with no OAuth-token fallback that
  // would look the user up and bind an organization.
  it('rejects a bearer token that is not a valid session', async () => {
    mockGetSession.mockResolvedValue(null);
    const { context, request } = createContext({
      authorization: 'Bearer some_oauth_access_token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(forwardedAuthorization()).toBe('Bearer some_oauth_access_token');
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockMemberFindMany).not.toHaveBeenCalled();
    expect(request.userId).toBeUndefined();
    expect(request.organizationId).toBeUndefined();
  });
});

describe('HybridAuthGuard — service token x-user-id acting member', () => {
  let guard: HybridAuthGuard;
  let reflector: Reflector;

  const createContext = (
    headers: Record<string, string>,
  ): { context: ExecutionContext; request: Record<string, unknown> } => {
    const request: Record<string, unknown> = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  const svcHeaders = (userId?: string): Record<string, string> => ({
    'x-service-token': 'valid_service_token',
    'x-organization-id': 'org_1',
    ...(userId ? { 'x-user-id': userId } : {}),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        {
          provide: ApiKeyService,
          useValue: { extractApiKey: jest.fn(), validateApiKey: jest.fn() },
        },
        Reflector,
      ],
    }).compile();
    guard = module.get<HybridAuthGuard>(HybridAuthGuard);
    reflector = module.get<Reflector>(Reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    // Valid service token + existing org so we reach the x-user-id block.
    mockResolveServiceByToken.mockReturnValue({
      definition: { name: 'Trigger.dev' },
    });
    mockOrgFindUnique.mockResolvedValue({ id: 'org_1' });
    mockMemberFindFirst.mockResolvedValue(null);
  });

  it('attributes an ACTIVE member: sets request.userId + memberId, scoped to active memberships', async () => {
    mockMemberFindFirst.mockResolvedValue({
      id: 'mem_active',
      userId: 'usr_active',
    });

    const { context, request } = createContext(svcHeaders('usr_active'));
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.userId).toBe('usr_active');
    expect(request.memberId).toBe('mem_active');
    // The lookup must exclude deactivated/inactive memberships.
    expect(mockMemberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'usr_active',
          organizationId: 'org_1',
          deactivated: false,
          isActive: true,
        }),
      }),
    );
  });

  it('does NOT attribute a deactivated/inactive member (no userId/memberId set)', async () => {
    // The active-only filter yields no row for an offboarded member.
    mockMemberFindFirst.mockResolvedValue(null);

    const { context, request } = createContext(svcHeaders('usr_offboarded'));
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.userId).toBeUndefined();
    expect(request.memberId).toBeUndefined();
    // Auth still succeeds as a service token, just with no acting user.
    expect(request.isServiceToken).toBe(true);
  });
});
