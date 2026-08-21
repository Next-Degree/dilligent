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

function run(options: { members: VercelTeamMember[]; membersError?: Error }) {
  const recorded = makeCheckContext({
    teamId: TEAM_ID,
    handle: (path) => {
      if (path.startsWith('/v2/teams/')) {
        return { id: TEAM_ID, name: 'Acme' } satisfies VercelTeamDetails;
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
  it('reports 2FA as unverified at team level, naming the enforcement setting', async () => {
    const recorded = await run({ members: [makeMember()] });

    const control = findByResourceId(recorded.fails, 'two-factor-auth');
    expect(control?.severity).toBe('high');
    expect(control?.evidence).toMatchObject({
      verificationBasis: 'not-verifiable',
      providerExposesTeam2faEnforcement: false,
      providerExposesPerMember2fa: false,
    });
    expect(control?.remediation).toContain('Two-Factor Authentication Enforcement');
  });

  it('never claims a member has 2FA disabled', async () => {
    const recorded = await run({ members: [makeMember()] });

    const person = findByResourceId(recorded.fails, 'jane@acme.com');
    expect(person?.title).toContain('2FA unverified');
    expect(person?.description).not.toContain('does not have');
    expect(recorded.passes).toHaveLength(0);
  });

  it('does not treat SSO as the basis for 2FA', async () => {
    const recorded = await run({ members: [makeMember()] });

    const serialized = JSON.stringify(recorded.fails).toLowerCase();
    expect(serialized).not.toContain('saml');
    expect(serialized).not.toContain('sso');
  });

  it('escalates privileged roles and keeps rows keyed by lowercased email', async () => {
    const recorded = await run({
      members: [
        makeMember({ role: 'OWNER' }),
        makeMember({ uid: 'usr_2', email: 'dev@acme.com', role: 'MEMBER' }),
      ],
    });

    expect(findByResourceId(recorded.fails, 'jane@acme.com')?.severity).toBe('high');
    expect(findByResourceId(recorded.fails, 'dev@acme.com')?.severity).toBe('medium');
  });

  it('falls back to the uid when a member has no email', async () => {
    const recorded = await run({
      members: [makeMember({ uid: 'usr_9', email: undefined, name: 'No Email' })],
    });

    expect(findByResourceId(recorded.fails, 'usr_9')?.resourceType).toBe('user');
  });

  it('reports a member read failure instead of an empty result', async () => {
    const recorded = await run({ members: [], membersError: httpError(403) });

    expect(recorded.fails).toHaveLength(1);
    expect(recorded.fails[0]?.title).toBe('Failed to read Vercel team members');
  });
});
