import { describe, expect, it } from 'bun:test';
import { twoFactorCheck } from '../checks';
import { RAILWAY_GRAPHQL_ENDPOINT } from '../client';
import type { RailwayWorkspace, RailwayWorkspaceMember } from '../types';
import { WORKSPACE, findByResourceId, makeRailwayContext } from './harness';

const member = (
  overrides: Partial<RailwayWorkspaceMember> & { id: string },
): RailwayWorkspaceMember => ({
  email: `${overrides.id}@acme.com`,
  name: null,
  role: 'MEMBER',
  twoFactorAuthEnabled: true,
  ...overrides,
});

const workspace = (overrides: Partial<RailwayWorkspace> = {}): RailwayWorkspace => ({
  ...WORKSPACE,
  has2FAEnforcement: true,
  members: [member({ id: 'u1' })],
  ...overrides,
});

const run = async (ws: RailwayWorkspace) => {
  const recorded = makeRailwayContext({
    tokenWorkspaces: [WORKSPACE],
    workspaces: { [WORKSPACE.id]: ws },
  });
  await twoFactorCheck.run(recorded.ctx);
  return recorded;
};

describe('twoFactorCheck', () => {
  it('passes enforcement and every member with 2FA, against the v2 endpoint', async () => {
    const recorded = await run(workspace());

    expect(findByResourceId(recorded.passes, 'ws-1')?.title).toBe('2FA enforced: Acme');
    expect(findByResourceId(recorded.passes, 'ws-1:u1')?.title).toBe('2FA enabled: u1@acme.com');
    expect(recorded.fails).toHaveLength(0);
    expect(new Set(recorded.endpoints)).toEqual(new Set([RAILWAY_GRAPHQL_ENDPOINT]));
  });

  it('fails a workspace that does not enforce 2FA even when every member has it', async () => {
    const recorded = await run(workspace({ has2FAEnforcement: false }));

    const finding = findByResourceId(recorded.fails, 'ws-1');
    expect(finding?.title).toBe('2FA not enforced: Acme');
    expect(finding?.severity).toBe('high');
    expect(findByResourceId(recorded.passes, 'ws-1:u1')).toBeDefined();
  });

  it('fails a member without 2FA, critical for an admin', async () => {
    const recorded = await run(
      workspace({
        members: [
          member({ id: 'dev', twoFactorAuthEnabled: false }),
          member({ id: 'boss', role: 'ADMIN', twoFactorAuthEnabled: false }),
        ],
      }),
    );

    expect(findByResourceId(recorded.fails, 'ws-1:dev')?.severity).toBe('high');
    expect(findByResourceId(recorded.fails, 'ws-1:boss')?.severity).toBe('critical');
  });

  it('reports a withheld 2FA flag as unknown rather than enabled', async () => {
    const recorded = await run(
      workspace({ members: [member({ id: 'u1', twoFactorAuthEnabled: null })] }),
    );

    const finding = findByResourceId(recorded.fails, 'ws-1:u1');
    expect(finding?.title).toBe('2FA status unknown: u1@acme.com');
    expect(finding?.severity).toBe('medium');
    expect(findByResourceId(recorded.passes, 'ws-1:u1')).toBeUndefined();
  });

  it('fails on an empty member list instead of passing on no data', async () => {
    const recorded = await run(workspace({ members: [] }));

    expect(findByResourceId(recorded.fails, 'ws-1:members')?.title).toBe(
      'No members returned for Acme',
    );
  });

  it('reports a denied workspace read', async () => {
    const recorded = makeRailwayContext({
      tokenWorkspaces: [WORKSPACE],
      workspaces: { [WORKSPACE.id]: new Error('GraphQL: Not Authorized') },
    });
    await twoFactorCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.fails, 'ws-1')?.title).toBe(
      'Could not read Railway workspace Acme',
    );
    expect(recorded.passes).toHaveLength(0);
  });
});

describe('workspace discovery', () => {
  it('falls back to the account workspaces when the token lists none', async () => {
    const recorded = makeRailwayContext({
      tokenWorkspaces: new Error('GraphQL: Not Authorized'),
      userWorkspaces: [WORKSPACE],
      workspaces: { [WORKSPACE.id]: workspace() },
    });
    await twoFactorCheck.run(recorded.ctx);

    expect(recorded.operations.slice(0, 2)).toEqual([
      'RailwayTokenWorkspaces',
      'RailwayUserWorkspaces',
    ]);
    expect(findByResourceId(recorded.passes, 'ws-1')).toBeDefined();
  });

  it('reports the first error when both discovery routes fail', async () => {
    const recorded = makeRailwayContext({
      tokenWorkspaces: new Error('GraphQL: token error'),
      userWorkspaces: new Error('GraphQL: me error'),
    });
    await twoFactorCheck.run(recorded.ctx);

    const finding = findByResourceId(recorded.fails, 'workspaces');
    expect(finding?.title).toBe('Failed to list Railway workspaces');
    expect(finding?.description).toContain('token error');
  });

  it('fails when the token resolves to no workspace', async () => {
    const recorded = makeRailwayContext({ tokenWorkspaces: [], userWorkspaces: [] });
    await twoFactorCheck.run(recorded.ctx);

    expect(findByResourceId(recorded.fails, 'workspaces')?.title).toBe(
      'No Railway workspace found',
    );
  });
});
