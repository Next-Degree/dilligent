import { describe, expect, it } from 'bun:test';
import type { CheckVariableValues } from '../../../types';
import { accountDeprovisioningCheck } from '../checks/account-deprovisioning';
import type {
  VercelEmailInviteCode,
  VercelTeamDetails,
  VercelTeamMember,
  VercelTeamMembersResponse,
} from '../types';
import { findByResourceId, makeCheckContext } from './context';

const TEAM_ID = 'team_1';
const DAY_MS = 24 * 60 * 60 * 1000;

const makeMember = (overrides: Partial<VercelTeamMember> = {}): VercelTeamMember => ({
  uid: 'usr_1',
  email: 'jane@acme.com',
  name: 'Jane Doe',
  role: 'MEMBER',
  confirmed: true,
  createdAt: 1_700_000_000_000,
  ...overrides,
});

const GOVERNED_TEAM: Partial<VercelTeamDetails> = {
  saml: {
    connection: { state: 'active', type: 'OktaSAML' },
    directory: { state: 'active', syncState: 'ACTIVE' },
    enforced: true,
  },
};

function run(options: {
  members: VercelTeamMember[];
  invites?: VercelEmailInviteCode[];
  team?: Partial<VercelTeamDetails>;
  variables?: CheckVariableValues;
}) {
  const recorded = makeCheckContext({
    variables: options.variables,
    teamId: TEAM_ID,
    handle: (path) => {
      if (path.startsWith('/v2/teams/')) {
        return { id: TEAM_ID, name: 'Acme', ...options.team } satisfies VercelTeamDetails;
      }
      if (path.includes('/members')) {
        return {
          members: options.members,
          emailInviteCodes: options.invites ?? [],
        } satisfies VercelTeamMembersResponse;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return accountDeprovisioningCheck.run(recorded.ctx).then(() => recorded);
}

describe('accountDeprovisioningCheck identity provider coverage', () => {
  it('fails the control and keeps member rows informational when no IdP is connected', async () => {
    const recorded = await run({
      members: [makeMember(), makeMember({ uid: 'usr_2', email: 'john@acme.com' })],
    });

    const control = findByResourceId(recorded.fails, 'deprovisioning-controls');
    expect(control?.severity).toBe('high');
    expect(control?.title).toBe('No identity provider connected to Vercel');
    // The gap is org-level — it must not repeat as a fail for every employee.
    expect(recorded.fails).toHaveLength(1);
    expect(
      recorded.passes
        .filter((result) => result.resourceType === 'user')
        .map((r) => r.resourceId)
        .sort(),
    ).toEqual(['jane@acme.com', 'john@acme.com']);
  });

  it('passes the control when Directory Sync is active and SSO is enforced', async () => {
    const recorded = await run({
      team: GOVERNED_TEAM,
      members: [makeMember({ joinedFrom: { origin: 'saml', dsyncUserId: 'dsync_1' } })],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'deprovisioning-controls')?.evidence).toMatchObject({
      directoryConnected: true,
      samlEnforced: true,
    });
    expect(findByResourceId(recorded.passes, 'jane@acme.com')?.title).toBe(
      'Account deprovisioned by the identity provider',
    );
  });

  it('flags a connected-but-unenforced identity provider', async () => {
    const recorded = await run({
      team: {
        saml: {
          connection: { state: 'active' },
          directory: { state: 'active' },
          enforced: false,
        },
      },
      members: [makeMember({ isEnterpriseManaged: true })],
    });

    const control = findByResourceId(recorded.fails, 'deprovisioning-controls');
    expect(control?.severity).toBe('medium');
    expect(control?.description).toContain('not enforced');
  });

  it('fails members that bypass the identity provider', async () => {
    const recorded = await run({
      team: GOVERNED_TEAM,
      members: [
        makeMember({ uid: 'usr_1', joinedFrom: { origin: 'saml', ssoUserId: 'sso_1' } }),
        makeMember({ uid: 'usr_2', email: 'contractor@acme.com', role: 'MEMBER' }),
        makeMember({ uid: 'usr_3', email: 'owner@acme.com', role: 'OWNER' }),
      ],
    });

    expect(recorded.fails.map((finding) => finding.resourceId).sort()).toEqual([
      'contractor@acme.com',
      'owner@acme.com',
    ]);
    expect(findByResourceId(recorded.fails, 'owner@acme.com')?.severity).toBe('high');
    expect(findByResourceId(recorded.fails, 'contractor@acme.com')?.severity).toBe('medium');
  });
});

describe('accountDeprovisioningCheck pending invitations', () => {
  const freshInvite: VercelEmailInviteCode = {
    id: 'inv_fresh',
    email: 'New@acme.com',
    createdAt: Date.now() - 2 * DAY_MS,
  };

  it('passes invitations inside the age limit and fails stale ones', async () => {
    const recorded = await run({
      team: GOVERNED_TEAM,
      members: [],
      invites: [
        freshInvite,
        { id: 'inv_old', email: 'old@acme.com', createdAt: Date.now() - 45 * DAY_MS },
        { id: 'inv_expired', email: 'gone@acme.com', createdAt: Date.now(), expired: true },
      ],
    });

    expect(findByResourceId(recorded.passes, 'new@acme.com')?.resourceType).toBe('invite');
    expect(recorded.fails.map((finding) => finding.resourceId).sort()).toEqual([
      'gone@acme.com',
      'old@acme.com',
    ]);
    expect(findByResourceId(recorded.fails, 'old@acme.com')?.description).toContain(
      '45 day(s) old',
    );
  });

  it('honours a configured age limit', async () => {
    const recorded = await run({
      team: GOVERNED_TEAM,
      members: [],
      invites: [{ id: 'inv_1', email: 'new@acme.com', createdAt: Date.now() - 5 * DAY_MS }],
      variables: { pending_invite_max_age_days: 3 },
    });

    expect(findByResourceId(recorded.fails, 'new@acme.com')?.evidence).toMatchObject({
      maxInviteAgeDays: 3,
      ageDays: 5,
    });
  });
});
