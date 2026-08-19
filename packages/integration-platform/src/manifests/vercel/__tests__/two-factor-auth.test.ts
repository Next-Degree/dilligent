import { describe, expect, it } from 'bun:test';
import { twoFactorAuthCheck } from '../checks/two-factor-auth';
import type { VercelTeamDetails, VercelTeamMember, VercelTeamMembersResponse } from '../types';
import { findByResourceId, httpError, makeCheckContext } from './context';

const TEAM_ID = 'team_1';

const makeMember = (overrides: Partial<VercelTeamMember> = {}): VercelTeamMember => ({
  uid: 'usr_1',
  email: 'Jane@Acme.com',
  name: 'Jane Doe',
  role: 'MEMBER',
  confirmed: true,
  createdAt: 1_700_000_000_000,
  ...overrides,
});

function run(options: {
  members: VercelTeamMember[];
  team?: Partial<VercelTeamDetails>;
  membersError?: Error;
}) {
  const recorded = makeCheckContext({
    teamId: TEAM_ID,
    handle: (path) => {
      if (path.startsWith('/v2/teams/')) {
        return { id: TEAM_ID, name: 'Acme', ...options.team } satisfies VercelTeamDetails;
      }
      if (path.includes('/members')) {
        if (options.membersError) throw options.membersError;
        return { members: options.members } satisfies VercelTeamMembersResponse;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return twoFactorAuthCheck.run(recorded.ctx).then(() => recorded);
}

describe('twoFactorAuthCheck', () => {
  it('passes every member when SAML SSO is connected and enforced', async () => {
    const recorded = await run({
      team: { saml: { connection: { state: 'active' }, enforced: true } },
      members: [makeMember(), makeMember({ uid: 'usr_2', email: 'john@acme.com', role: 'OWNER' })],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'two-factor-auth')?.evidence).toMatchObject({
      verificationBasis: 'saml-sso-enforced',
      providerExposesPerMember2fa: false,
    });
    expect(
      recorded.passes
        .filter((r) => r.resourceType === 'user')
        .map((r) => r.resourceId)
        .sort(),
    ).toEqual(['jane@acme.com', 'john@acme.com']);
  });

  it('reports 2FA as unverified — not disabled — when SSO is not enforced', async () => {
    const recorded = await run({
      team: { saml: { connection: { state: 'active' }, enforced: false } },
      members: [makeMember({ role: 'OWNER' }), makeMember({ uid: 'usr_2', email: 'dev@acme.com' })],
    });

    const control = findByResourceId(recorded.fails, 'two-factor-auth');
    expect(control?.severity).toBe('high');
    expect(control?.description).toContain('connected but not enforced');
    expect(control?.evidence).toMatchObject({ verificationBasis: 'not-verifiable' });

    const owner = findByResourceId(recorded.fails, 'jane@acme.com');
    expect(owner?.title).toContain('2FA unverified');
    expect(owner?.severity).toBe('high');
    expect(findByResourceId(recorded.fails, 'dev@acme.com')?.severity).toBe('medium');
  });

  it('fails when no SAML connection exists at all', async () => {
    const recorded = await run({ members: [makeMember()] });

    expect(findByResourceId(recorded.fails, 'two-factor-auth')?.description).toContain(
      'not connected',
    );
    expect(findByResourceId(recorded.fails, 'jane@acme.com')).toBeDefined();
  });

  it('falls back to the uid when a member has no email', async () => {
    const recorded = await run({
      team: { saml: { connection: { state: 'active' }, enforced: true } },
      members: [makeMember({ uid: 'usr_9', email: undefined, name: 'No Email' })],
    });

    expect(findByResourceId(recorded.passes, 'usr_9')?.resourceType).toBe('user');
  });

  it('reports a member read failure instead of claiming coverage', async () => {
    const recorded = await run({
      team: { saml: { connection: { state: 'active' }, enforced: true } },
      members: [],
      membersError: httpError(403),
    });

    expect(recorded.fails).toHaveLength(1);
    expect(recorded.fails[0]?.title).toBe('Failed to read Vercel team members');
    expect(recorded.passes).toHaveLength(0);
  });
});
