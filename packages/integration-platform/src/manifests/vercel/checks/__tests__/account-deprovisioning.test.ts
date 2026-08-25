import { describe, expect, it } from 'bun:test';
import type { CheckVariableValues, DirectoryPerson } from '../../../../types';
import type {
  VercelEmailInviteCode,
  VercelTeamDetails,
  VercelTeamMember,
  VercelTeamMembersResponse,
} from '../../types';
import { accountDeprovisioningCheck } from '../account-deprovisioning';
import {
  findByResourceId,
  makeCheckContext,
  makePerson,
  makePersonWithLinkedVercel,
} from './harness';

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

function run(options: {
  members: VercelTeamMember[];
  people?: DirectoryPerson[];
  invites?: VercelEmailInviteCode[];
  variables?: CheckVariableValues;
  directoryError?: Error;
  omitDirectory?: boolean;
}) {
  const recorded = makeCheckContext({
    variables: options.variables,
    teamId: TEAM_ID,
    people: options.omitDirectory ? undefined : (options.people ?? []),
    directoryError: options.directoryError,
    handle: (path) => {
      if (path.startsWith('/v2/teams/')) {
        return { id: TEAM_ID, name: 'Acme' } satisfies VercelTeamDetails;
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

describe('accountDeprovisioningCheck directory reconciliation', () => {
  it('passes accounts belonging to active employees', async () => {
    const recorded = await run({
      members: [makeMember(), makeMember({ uid: 'usr_2', email: 'john@acme.com' })],
      people: [makePerson({ email: 'jane@acme.com' }), makePerson({ email: 'john@acme.com' })],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'jane@acme.com')?.title).toBe(
      'Account belongs to an active employee',
    );
  });

  it('flags a leaver who still holds Vercel access', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'gone@acme.com', name: 'Gone Person' })],
      people: [
        makePerson({
          email: 'gone@acme.com',
          isActive: false,
          offboardDate: '2026-07-01T00:00:00.000Z',
        }),
      ],
    });

    const finding = findByResourceId(recorded.fails, 'gone@acme.com');
    expect(finding?.severity).toBe('high');
    expect(finding?.title).toContain('Access not removed for leaver');
    expect(finding?.description).toContain('2026-07-01');
  });

  it('flags an account that matches nobody on the roster', async () => {
    const recorded = await run({
      members: [
        makeMember({ uid: 'usr_x', email: 'stranger@acme.com', role: 'MEMBER' }),
        makeMember({ uid: 'usr_y', email: 'ghost@acme.com', role: 'OWNER' }),
      ],
      people: [makePerson({ email: 'jane@acme.com' })],
    });

    expect(recorded.fails.map((f) => f.resourceId).sort()).toEqual([
      'ghost@acme.com',
      'stranger@acme.com',
    ]);
    expect(findByResourceId(recorded.fails, 'ghost@acme.com')?.severity).toBe('high');
    expect(findByResourceId(recorded.fails, 'stranger@acme.com')?.severity).toBe('medium');
  });

  it('matches an account held under a linked provider email', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'jane@personal.dev' })],
      people: [makePersonWithLinkedVercel({ email: 'jane@acme.com', linked: 'jane@personal.dev' })],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'jane@personal.dev')?.evidence).toMatchObject({
      matchedEmployee: { matchedOnLinkedEmail: true },
    });
  });

  it('matches on a github-sourced linked email, the only kind People records hold', async () => {
    // Vercel accounts are usually created by signing in with GitHub, and
    // `EXTERNAL_USER_SOURCES` is ['github'], so a 'vercel'-only source filter
    // would match nobody and report every such account as an orphan.
    const recorded = await run({
      members: [makeMember({ email: 'jane@personal.dev' })],
      people: [
        makePerson({
          email: 'jane@acme.com',
          linkedEmails: [{ source: 'github', email: 'jane@personal.dev' }],
        }),
      ],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'jane@personal.dev')).toBeDefined();
  });

  it('ignores an email linked for an unrelated provider', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'jane@personal.dev' })],
      people: [
        makePerson({
          email: 'jane@acme.com',
          linkedEmails: [{ source: 'okta', email: 'jane@personal.dev' }],
        }),
      ],
    });

    expect(findByResourceId(recorded.fails, 'jane@personal.dev')).toBeDefined();
  });

  it('prefers the active member when an email appears on two records', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'shared@acme.com' })],
      people: [
        makePerson({ email: 'shared@acme.com', isActive: false, name: 'Archived' }),
        makePerson({ email: 'shared@acme.com', isActive: true, name: 'Current' }),
      ],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'shared@acme.com')?.evidence).toMatchObject({
      matchedEmployee: { name: 'Current' },
    });
  });

  it('reports unverified rather than flagging everyone when the directory is unavailable', async () => {
    const recorded = await run({ members: [makeMember()], omitDirectory: true });

    expect(recorded.fails).toHaveLength(1);
    expect(recorded.fails[0]?.resourceId).toBe('people-directory');
    expect(recorded.fails[0]?.title).toContain('Cannot verify deprovisioning');
  });

  it('reports unverified when the directory lookup throws', async () => {
    const recorded = await run({
      members: [makeMember()],
      directoryError: new Error('database unavailable'),
    });

    // The throw is absorbed by loadDirectoryByEmail and surfaced via ctx.warn,
    // so the finding reads the same as an absent directory: one row, not a
    // finding against every account.
    expect(recorded.fails).toHaveLength(1);
    expect(findByResourceId(recorded.fails, 'people-directory')?.title).toContain(
      'Cannot verify deprovisioning',
    );
  });
});

describe('accountDeprovisioningCheck pending invitations', () => {
  const people = [makePerson({ email: 'jane@acme.com' })];

  it('passes fresh invitations and fails stale or expired ones', async () => {
    const recorded = await run({
      members: [],
      people,
      invites: [
        { id: 'inv_fresh', email: 'New@acme.com', createdAt: Date.now() - 2 * DAY_MS },
        { id: 'inv_old', email: 'old@acme.com', createdAt: Date.now() - 45 * DAY_MS },
        { id: 'inv_expired', email: 'gone@acme.com', createdAt: Date.now(), expired: true },
      ],
    });

    expect(findByResourceId(recorded.passes, 'new@acme.com')?.resourceType).toBe('invite');
    expect(recorded.fails.map((f) => f.resourceId).sort()).toEqual([
      'gone@acme.com',
      'old@acme.com',
    ]);
  });

  it('honours a configured age limit', async () => {
    const recorded = await run({
      members: [],
      people,
      invites: [{ id: 'inv_1', email: 'new@acme.com', createdAt: Date.now() - 5 * DAY_MS }],
      variables: { pending_invite_max_age_days: 3 },
    });

    expect(findByResourceId(recorded.fails, 'new@acme.com')?.evidence).toMatchObject({
      maxInviteAgeDays: 3,
      ageDays: 5,
    });
  });
});
