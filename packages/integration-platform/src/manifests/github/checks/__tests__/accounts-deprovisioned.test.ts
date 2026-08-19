import { describe, expect, it } from 'bun:test';
import { accountsDeprovisionedCheck } from '../accounts-deprovisioned';
import { makePerson, runGithubCheck, type HarnessOptions } from './harness';

interface AccountFixture {
  login: string;
  samlEmail?: string;
  isAdmin?: boolean;
  outsideCollaborator?: boolean;
}

interface InvitationFixture {
  id: number;
  login: string;
  daysOld: number;
}

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

function buildOptions({
  accounts,
  invitations = [],
  overrides = {},
}: {
  accounts: AccountFixture[];
  invitations?: InvitationFixture[];
  overrides?: Partial<HarnessOptions>;
}): HarnessOptions {
  const member = (account: AccountFixture) => ({
    login: account.login,
    id: account.login.length,
    html_url: `https://github.com/${account.login}`,
    type: 'User',
  });

  return {
    variables: { target_repos: ['acme/api:main'] },
    fetchAllPages: async (path: string) => {
      if (path === '/orgs/acme/members') {
        return accounts.filter((a) => !a.outsideCollaborator).map(member);
      }
      if (path === '/orgs/acme/members?role=admin') {
        return accounts.filter((a) => a.isAdmin).map(member);
      }
      if (path === '/orgs/acme/outside_collaborators') {
        return accounts.filter((a) => a.outsideCollaborator).map(member);
      }
      if (path === '/orgs/acme/invitations') {
        return invitations.map((invitation) => ({
          id: invitation.id,
          login: invitation.login,
          email: null,
          role: 'direct_member',
          created_at: daysAgo(invitation.daysOld),
          inviter: { login: 'alice' },
        }));
      }
      throw new Error(`Unexpected path: ${path}`);
    },
    fetch: async (path: string) => {
      const match = path.match(/^\/users\/(.+)$/);
      if (!match) throw new Error(`Unexpected path: ${path}`);
      return { login: match[1], id: 1, name: null, email: null, html_url: path };
    },
    graphql: async () => ({
      organization: {
        samlIdentityProvider: {
          externalIdentities: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: accounts
              .filter((a) => a.samlEmail)
              .map((a) => ({
                user: { login: a.login },
                samlIdentity: { nameId: a.samlEmail ?? null },
                scimIdentity: null,
              })),
          },
        },
      },
    }),
    ...overrides,
  };
}

const run = (args: Parameters<typeof buildOptions>[0]) =>
  runGithubCheck(accountsDeprovisionedCheck, buildOptions(args));

describe('accountsDeprovisionedCheck', () => {
  it('passes when everyone with access is active in the directory', async () => {
    const { passed, failed } = await run({
      accounts: [{ login: 'alice', samlEmail: 'alice@acme.com' }],
      overrides: { people: [makePerson({ email: 'alice@acme.com', isActive: true })] },
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.title).toBe('No departed personnel retain GitHub access in acme');
  });

  it('fails when an offboarded person still has organization access', async () => {
    const { passed, failed } = await run({
      accounts: [{ login: 'bob', samlEmail: 'bob@acme.com' }],
      overrides: {
        people: [
          makePerson({
            email: 'bob@acme.com',
            name: 'Bob B',
            isActive: false,
            offboardDate: '2026-01-15T00:00:00.000Z',
          }),
        ],
      },
    });

    expect(passed).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('Departed person still has GitHub access: @bob');
    expect(failed[0]?.severity).toBe('high');
    expect(failed[0]?.description).toContain('offboarded on 2026-01-15');
  });

  it('escalates to critical when the departed person is an organization owner', async () => {
    const { failed } = await run({
      accounts: [{ login: 'bob', samlEmail: 'bob@acme.com', isAdmin: true }],
      overrides: { people: [makePerson({ email: 'bob@acme.com', isActive: false })] },
    });

    expect(failed[0]?.severity).toBe('critical');
    expect(failed[0]?.description).toContain('owner privileges');
  });

  it('describes an inactive person without an offboard date', async () => {
    const { failed } = await run({
      accounts: [{ login: 'bob', samlEmail: 'bob@acme.com' }],
      overrides: {
        people: [makePerson({ email: 'bob@acme.com', isActive: false, offboardDate: null })],
      },
    });

    expect(failed[0]?.description).toContain('marked inactive in your People directory');
  });

  it('leaves unmatched accounts to the association check', async () => {
    const { passed, failed } = await run({
      accounts: [{ login: 'stranger', samlEmail: 'stranger@other.com' }],
      overrides: { people: [makePerson({ email: 'alice@acme.com' })] },
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
  });

  it('fails a pending invitation older than the threshold', async () => {
    const { failed } = await run({
      accounts: [],
      invitations: [{ id: 42, login: 'newhire', daysOld: 60 }],
      overrides: { people: [] },
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('Stale GitHub invitation pending: newhire');
    expect(failed[0]?.severity).toBe('medium');
    expect(failed[0]?.resourceId).toBe('acme/invitation/42');
  });

  it('ignores a recent pending invitation', async () => {
    const { passed, failed } = await run({
      accounts: [],
      invitations: [{ id: 43, login: 'newhire', daysOld: 3 }],
      overrides: { people: [] },
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
  });

  it('honors a custom stale-invitation threshold', async () => {
    const options = buildOptions({
      accounts: [],
      invitations: [{ id: 44, login: 'newhire', daysOld: 10 }],
      overrides: { people: [] },
    });
    const { failed } = await runGithubCheck(accountsDeprovisionedCheck, {
      ...options,
      variables: { ...options.variables, stale_invitation_days: 7 },
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.description).toContain('7-day threshold');
  });

  it('reports departed outside collaborators too', async () => {
    const { failed } = await run({
      accounts: [{ login: 'contractor', samlEmail: 'c@vendor.com', outsideCollaborator: true }],
      overrides: { people: [makePerson({ email: 'c@vendor.com', isActive: false })] },
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.description).toContain('outside collaborator');
  });

  it('fails loudly when no People directory is available', async () => {
    const { passed, failed } = await run({
      accounts: [{ login: 'alice', samlEmail: 'alice@acme.com' }],
    });

    expect(passed).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('Cannot verify deprovisioning without the People directory');
  });

  it('fails with a configuration finding when no repositories are selected', async () => {
    const { failed } = await runGithubCheck(accountsDeprovisionedCheck, {
      variables: { target_repos: [] },
    });

    expect(failed[0]?.title).toBe('No repositories configured');
    expect(failed[0]?.severity).toBe('low');
  });
});
