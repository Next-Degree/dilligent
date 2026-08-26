import { describe, expect, it } from 'bun:test';
import type { CheckVariableValues } from '../../../../types';
import type { VercelTeamDetails, VercelTeamMember, VercelTeamMembersResponse } from '../../types';
import { twoFactorAuthCheck } from '../two-factor-auth';
import { findByResourceId, httpError, makeCheckContext } from './harness';

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

function run(
  options: {
    members?: VercelTeamMember[];
    membersError?: Error;
    variables?: CheckVariableValues;
    teamId?: string | null;
  } = {},
) {
  const recorded = makeCheckContext({
    variables: options.variables,
    teamId: options.teamId === null ? undefined : (options.teamId ?? TEAM_ID),
    handle: (path) => {
      if (path.startsWith('/v2/teams/')) {
        return { id: TEAM_ID, name: 'Acme' } satisfies VercelTeamDetails;
      }
      if (path.includes('/members')) {
        if (options.membersError) throw options.membersError;
        return { members: options.members ?? [makeMember()] } satisfies VercelTeamMembersResponse;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return twoFactorAuthCheck.run(recorded.ctx).then(() => recorded);
}

describe('twoFactorAuthCheck', () => {
  it('fails when enforcement has not been confirmed', async () => {
    const recorded = await run();

    expect(recorded.passes).toHaveLength(0);
    const control = findByResourceId(recorded.fails, 'two-factor-auth');
    expect(control?.severity).toBe('high');
    expect(control?.remediation).toContain('Two-Factor Authentication Enforcement');
  });

  it('passes when an administrator confirms enforcement', async () => {
    const recorded = await run({ variables: { team_2fa_enforced: true } });

    expect(recorded.fails).toHaveLength(0);
    const control = findByResourceId(recorded.passes, 'two-factor-auth');
    expect(control?.title).toBe('Team requires two-factor authentication');
    expect(control?.evidence).toMatchObject({ enforced: true, memberCount: 1 });
  });

  it('records the basis as an attestation, never as an observation', async () => {
    for (const variables of [undefined, { team_2fa_enforced: true }]) {
      const recorded = await run({ variables });
      const result = [...recorded.passes, ...recorded.fails][0];

      expect(result?.evidence).toMatchObject({
        verificationBasis: 'admin-attestation',
        providerExposesTeam2faEnforcement: false,
        providerExposesPerMember2fa: false,
      });
    }
  });

  it('emits exactly one team-scoped result and no per-member rows', async () => {
    const recorded = await run({
      members: [
        makeMember({ role: 'OWNER' }),
        makeMember({ uid: 'usr_2', email: 'dev@acme.com' }),
        makeMember({ uid: 'usr_3', email: 'ops@acme.com' }),
      ],
    });

    const all = [...recorded.passes, ...recorded.fails];
    expect(all).toHaveLength(1);
    expect(all[0]?.resourceType).toBe('vercel');
    // The team setting is the whole control; per-member 2FA is not readable and
    // a row per person would only repeat one team-level answer N times.
    expect(all.some((result) => result.resourceType === 'user')).toBe(false);
  });

  it('treats a string "true" from the variable store as confirmation', async () => {
    const recorded = await run({ variables: { team_2fa_enforced: 'true' } });

    expect(findByResourceId(recorded.passes, 'two-factor-auth')).toBeDefined();
  });

  it('does not treat SSO as the basis for 2FA', async () => {
    const recorded = await run({ variables: { team_2fa_enforced: true } });

    const serialized = JSON.stringify([...recorded.passes, ...recorded.fails]).toLowerCase();
    expect(serialized).not.toContain('saml');
    expect(serialized).not.toContain('sso');
  });

  it('still reports the attestation when the member count cannot be read', async () => {
    const recorded = await run({
      membersError: httpError(403),
      variables: { team_2fa_enforced: true },
    });

    // A roster read failure must not flip the team setting's answer.
    const control = findByResourceId(recorded.passes, 'two-factor-auth');
    expect(control?.evidence).toMatchObject({ memberCount: null, enforced: true });
    expect(recorded.fails).toHaveLength(0);
  });

  it('fails before reading anything when the connection is not scoped to a team', async () => {
    const recorded = await run({ teamId: null });

    expect(recorded.passes).toHaveLength(0);
    expect(recorded.fails).toHaveLength(1);
    expect(recorded.requests).toHaveLength(0);
  });
});
