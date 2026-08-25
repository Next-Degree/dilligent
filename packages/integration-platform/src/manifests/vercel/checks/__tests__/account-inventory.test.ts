import { describe, expect, it } from 'bun:test';
import type { CheckVariableValues, DirectoryPerson } from '../../../../types';
import type { VercelTeamDetails, VercelTeamMember, VercelTeamMembersResponse } from '../../types';
import { accountInventoryCheck } from '../account-inventory';
import {
  findByResourceId,
  httpError,
  makeCheckContext,
  makePerson,
  makePersonWithLinkedVercel,
} from './harness';

const TEAM_ID = 'team_1';

const makeMember = (overrides: Partial<VercelTeamMember> = {}): VercelTeamMember => ({
  uid: 'usr_1',
  email: 'jane@acme.com',
  username: 'jane',
  name: 'Jane Doe',
  role: 'MEMBER',
  confirmed: true,
  createdAt: 1_700_000_000_000,
  ...overrides,
});

function run(options: {
  members: VercelTeamMember[];
  team?: Partial<VercelTeamDetails>;
  variables?: CheckVariableValues;
  teamId?: string | null;
  membersError?: Error;
  people?: DirectoryPerson[];
}) {
  const recorded = makeCheckContext({
    variables: options.variables,
    teamId: options.teamId === null ? undefined : (options.teamId ?? TEAM_ID),
    people: options.people,
    handle: (path) => {
      if (path.startsWith(`/v2/teams/`)) {
        return { id: TEAM_ID, name: 'Acme', emailDomain: 'acme.com', ...options.team };
      }
      if (path.includes('/members')) {
        if (options.membersError) throw options.membersError;
        return { members: options.members } satisfies VercelTeamMembersResponse;
      }
      throw new Error(`Unexpected fetch: ${path}`);
    },
  });
  return accountInventoryCheck.run(recorded.ctx).then(() => recorded);
}

describe('accountInventoryCheck', () => {
  it('fails without fetching members when the connection is a personal account', async () => {
    const recorded = await run({ members: [], teamId: null });

    expect(recorded.fails).toHaveLength(1);
    expect(recorded.fails[0]?.resourceId).toBe('team');
    expect(recorded.requests).toHaveLength(0);
  });

  it('emits one pass row per member keyed by lowercased email', async () => {
    const recorded = await run({
      members: [
        makeMember({ uid: 'usr_1', email: 'Jane@Acme.com' }),
        makeMember({ uid: 'usr_2', email: 'john@acme.com', name: 'John Roe', role: 'OWNER' }),
      ],
    });

    const userPasses = recorded.passes.filter((result) => result.resourceType === 'user');
    expect(userPasses.map((result) => result.resourceId).sort()).toEqual([
      'jane@acme.com',
      'john@acme.com',
    ]);
    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'account-inventory')?.evidence).toMatchObject({
      totalAccounts: 2,
      unattributedAccounts: 0,
      roleCounts: { MEMBER: 1, OWNER: 1 },
    });
  });

  it('flags accounts that cannot be traced to one person', async () => {
    const recorded = await run({
      members: [
        makeMember({ uid: 'usr_1', email: undefined, name: undefined, username: undefined }),
        makeMember({ uid: 'usr_2', email: 'deploy@acme.com', name: 'Deploy Bot' }),
        makeMember({ uid: 'usr_3', email: 'someone@gmail.com', role: 'OWNER' }),
        makeMember({ uid: 'usr_4', email: 'pending@acme.com', confirmed: false }),
      ],
    });

    expect(recorded.fails.map((finding) => finding.resourceId).sort()).toEqual([
      'deploy@acme.com',
      'pending@acme.com',
      'someone@gmail.com',
      'usr_1',
    ]);
    expect(findByResourceId(recorded.fails, 'someone@gmail.com')?.severity).toBe('high');
    expect(findByResourceId(recorded.fails, 'deploy@acme.com')?.severity).toBe('medium');
    expect(findByResourceId(recorded.fails, 'usr_1')?.description).toContain('no email address');
    expect(findByResourceId(recorded.fails, 'pending@acme.com')?.description).toContain('pending');
  });

  it('prefers configured corporate domains over the team domain', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'jane@contractor.io' })],
      variables: { corporate_email_domains: 'acme.com, contractor.io' },
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'jane@contractor.io')).toBeDefined();
  });

  it('skips domain attribution when neither the team nor the config names a domain', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'jane@gmail.com' })],
      team: { emailDomain: null },
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'account-inventory')?.evidence).toMatchObject({
      corporateDomains: [],
    });
  });

  it('reports a permission failure instead of an empty roster', async () => {
    const recorded = await run({ members: [], membersError: httpError(403) });

    expect(recorded.fails).toHaveLength(1);
    expect(recorded.fails[0]?.title).toBe('Failed to read Vercel team members');
    expect(recorded.fails[0]?.remediation).toContain('Owner access');
    expect(recorded.fails[0]?.evidence).toMatchObject({ denied: true });
  });
});

describe('accountInventoryCheck pagination', () => {
  it('follows the members cursor until it runs out', async () => {
    const recorded = makeCheckContext({
      teamId: TEAM_ID,
      handle: (path) => {
        if (path.startsWith('/v2/teams/')) {
          return { id: TEAM_ID, emailDomain: 'acme.com' } satisfies VercelTeamDetails;
        }
        if (path.includes('until=1000')) {
          return {
            members: [makeMember({ uid: 'usr_2', email: 'john@acme.com' })],
            pagination: { next: null },
          } satisfies VercelTeamMembersResponse;
        }
        return {
          members: [makeMember({ uid: 'usr_1', email: 'jane@acme.com' })],
          pagination: { next: 1000 },
        } satisfies VercelTeamMembersResponse;
      },
    });

    await accountInventoryCheck.run(recorded.ctx);

    const userPasses = recorded.passes.filter((result) => result.resourceType === 'user');
    expect(userPasses.map((result) => result.resourceId).sort()).toEqual([
      'jane@acme.com',
      'john@acme.com',
    ]);
  });
});

describe('accountInventoryCheck directory attribution', () => {
  it('accepts an account held under a linked provider email', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'jane@personal.dev' })],
      people: [makePersonWithLinkedVercel({ email: 'jane@acme.com', linked: 'jane@personal.dev' })],
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'jane@personal.dev')?.evidence).toMatchObject({
      matchedEmployee: { matchedOnLinkedEmail: true },
    });
  });

  it('still flags an off-domain account that matches nobody', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'stranger@personal.dev' })],
      people: [makePerson({ email: 'jane@acme.com' })],
    });

    expect(findByResourceId(recorded.fails, 'stranger@personal.dev')?.description).toContain(
      'not one of the company',
    );
  });

  it('falls back to domain attribution when no directory is available', async () => {
    const recorded = await run({ members: [makeMember({ email: 'someone@gmail.com' })] });

    expect(findByResourceId(recorded.fails, 'someone@gmail.com')).toBeDefined();
    expect(findByResourceId(recorded.passes, 'account-inventory')?.evidence).toMatchObject({
      directoryAvailable: false,
    });
  });

  it('still flags a shared mailbox even when it matches a member record', async () => {
    const recorded = await run({
      members: [makeMember({ email: 'deploy@acme.com', name: 'Deploy Bot' })],
      people: [makePerson({ email: 'deploy@acme.com' })],
    });

    expect(findByResourceId(recorded.fails, 'deploy@acme.com')?.description).toContain(
      'shared mailbox',
    );
  });
});
