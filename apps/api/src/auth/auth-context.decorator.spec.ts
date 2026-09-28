import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AuthContext } from './auth-context.decorator';
import type {
  AuthContext as AuthContextType,
  AuthenticatedRequest,
} from './types';

type DecoratorFactory = (
  data: unknown,
  ctx: ExecutionContext,
) => AuthContextType;

// Nest stores a param decorator's factory in route-args metadata; pull it out
// so the real decorator runs against a real-shaped request.
function authContextFactory(): DecoratorFactory {
  class Probe {
    handler(@AuthContext() auth: AuthContextType) {
      return auth;
    }
  }
  const args: Record<string, { factory: DecoratorFactory }> =
    Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
  return Object.values(args)[0].factory;
}

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('@AuthContext()', () => {
  const factory = authContextFactory();

  it('passes API key scopes through, so handlers can enforce them', () => {
    const auth = factory(
      undefined,
      contextFor({
        organizationId: 'org_1',
        authType: 'api-key',
        isApiKey: true,
        isPlatformAdmin: false,
        userRoles: null,
        apiKeyScopes: ['app:read', 'task:read'],
      }),
    );

    expect(auth.apiKeyScopes).toEqual(['app:read', 'task:read']);
  });

  it('leaves scopes undefined for session callers', () => {
    const auth = factory(
      undefined,
      contextFor({
        organizationId: 'org_1',
        authType: 'session',
        isApiKey: false,
        isPlatformAdmin: false,
        userRoles: ['admin'],
        memberId: 'mem_1',
      }),
    );

    expect(auth.apiKeyScopes).toBeUndefined();
    expect(auth.memberId).toBe('mem_1');
  });

  it('throws when the auth guard has not run', () => {
    expect(() => factory(undefined, contextFor({}))).toThrow(
      'Authentication context not found',
    );
  });
});
