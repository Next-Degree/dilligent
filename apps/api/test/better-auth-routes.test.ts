/**
 * Our auth hooks match better-auth endpoints by path string. If an upgrade
 * renames one of those endpoints, the hook silently stops matching while the
 * mocked unit specs keep passing. This builds the real auth instance with the
 * installed better-auth and asserts every path the hooks depend on is still
 * served.
 *
 * Runs under bun (`bun test ./test/better-auth-routes.test.ts`), not Jest:
 * better-auth ships ESM-only modules that Jest cannot load on Node 22, which is
 * why the unit specs mock it.
 */
import { describe, expect, test } from 'bun:test';
// Must stay the first local import: sets env defaults before auth.server loads.
import './better-auth-routes.env';
import { ADMIN_AUDIT_DESCRIPTIONS } from '../src/auth/admin-audit-events';
import { AUTH_REQUEST_POLICY_PATHS } from '../src/auth/auth-request-policy';
import { auth } from '../src/auth/auth.server';
import { BLOCKED_MEMBERSHIP_PATHS } from '../src/auth/membership-route-policy';

function servedPaths(): Set<string> {
  const paths = new Set<string>();
  for (const endpoint of Object.values(auth.api) as unknown[]) {
    if (typeof endpoint !== 'function' && typeof endpoint !== 'object')
      continue;
    if (endpoint === null) continue;
    const path: unknown = Reflect.get(endpoint, 'path');
    if (typeof path === 'string') paths.add(path);
  }
  return paths;
}

const served = servedPaths();

function missing(paths: Iterable<string>): string[] {
  return [...paths].filter((path) => !served.has(path));
}

describe('better-auth routes our hooks depend on', () => {
  test('the instance exposes its endpoints', () => {
    expect(served.size).toBeGreaterThan(50);
    expect(missing(['/route-check/does-not-exist'])).toEqual([
      '/route-check/does-not-exist',
    ]);
  });

  test('auth request policy paths exist', () => {
    expect(AUTH_REQUEST_POLICY_PATHS.length).toBeGreaterThan(0);
    expect(missing(AUTH_REQUEST_POLICY_PATHS)).toEqual([]);
  });

  test('blocked membership paths exist', () => {
    expect(BLOCKED_MEMBERSHIP_PATHS.size).toBeGreaterThan(0);
    expect(missing(BLOCKED_MEMBERSHIP_PATHS)).toEqual([]);
  });

  test('audited admin paths exist', () => {
    const adminPaths = Object.keys(ADMIN_AUDIT_DESCRIPTIONS);
    expect(adminPaths.length).toBeGreaterThan(0);
    expect(missing(adminPaths)).toEqual([]);
  });
});
