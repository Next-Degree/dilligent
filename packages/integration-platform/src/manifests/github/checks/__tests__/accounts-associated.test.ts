import { describe, expect, it } from 'bun:test';
import { accountsAssociatedCheck } from '../accounts-associated';
import {
  makePerson,
  makePersonWithLinkedGithub,
  runGithubCheck,
  type HarnessOptions,
} from './harness';

interface AccountFixture {
  login: string;
  type?: string;
  /** Public profile email, when the account exposes one. */
  profileEmail?: string | null;
  name?: string | null;
  /** SAML nameId reported by the org's identity provider. */
  samlEmail?: string;
  /** Email GitHub verified against one of the org's verified domains. */
  verifiedDomainEmail?: string;
  isAdmin?: boolean;
  outsideCollaborator?: boolean;
}

function buildOptions(
  accounts: AccountFixture[],
  overrides: Partial<HarnessOptions> = {},
): HarnessOptions {
  const byLogin = new Map(accounts.map((account) => [account.login, account]));
  const member = (account: AccountFixture) => ({
    login: account.login,
    id: account.login.length,
    html_url: `https://github.com/${account.login}`,
    type: account.type ?? 'User',
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
      throw new Error(`Unexpected path: ${path}`);
    },
    fetch: async (path: string) => {
      const match = path.match(/^\/users\/(.+)$/);
      const account = match ? byLogin.get(match[1] ?? '') : undefined;
      if (!account) throw new Error('404 Not Found');
      return {
        login: account.login,
        id: 1,
        name: account.name ?? null,
        email: account.profileEmail ?? null,
        html_url: `https://github.com/${account.login}`,
      };
    },
    graphql: async (query: string) => {
      if (query.includes('organizationVerifiedDomainEmails')) {
        return {
          organization: {
            membersWithRole: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: accounts
                .filter((a) => a.verifiedDomainEmail)
                .map((a) => ({
                  login: a.login,
                  organizationVerifiedDomainEmails: [a.verifiedDomainEmail],
                })),
            },
          },
        };
      }
      return {
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
      };
    },
    ...overrides,
  };
}

const run = (accounts: AccountFixture[], overrides: Partial<HarnessOptions> = {}) =>
  runGithubCheck(accountsAssociatedCheck, buildOptions(accounts, overrides));

describe('accountsAssociatedCheck', () => {
  it('passes an account whose SAML identity matches a person in the directory', async () => {
    const { passed, failed } = await run([{ login: 'alice', samlEmail: 'alice@acme.com' }], {
      people: [makePerson({ email: 'alice@acme.com', name: 'Alice A' })],
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.resourceId).toBe('alice@acme.com');
    expect(passed[0]?.description).toContain('Alice A');
  });

  it('falls back to the public profile email when the org has no SSO identity', async () => {
    const { passed, failed } = await run([{ login: 'bob', profileEmail: 'BOB@acme.com' }], {
      people: [makePerson({ email: 'bob@acme.com', name: 'Bob B' })],
    });

    expect(failed).toEqual([]);
    expect(passed[0]?.resourceId).toBe('bob@acme.com');
  });

  it('prefers the SAML identity over a differing profile email', async () => {
    const { passed } = await run(
      [{ login: 'carol', samlEmail: 'carol@acme.com', profileEmail: 'personal@gmail.com' }],
      { people: [makePerson({ email: 'carol@acme.com' })] },
    );

    expect(passed[0]?.resourceId).toBe('carol@acme.com');
  });

  it('resolves an account through a verified domain email when the org has no SSO', async () => {
    const { passed, failed } = await run(
      [{ login: 'dccakes', name: 'Diego Carvallo', verifiedDomainEmail: 'Diego@Acme.com' }],
      { people: [makePerson({ email: 'diego@acme.com', name: 'Diego Carvallo' })] },
    );

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.resourceId).toBe('diego@acme.com');
  });

  it('prefers a verified domain email over a differing public profile email', async () => {
    const { passed } = await run(
      [{ login: 'erin', verifiedDomainEmail: 'erin@acme.com', profileEmail: 'personal@gmail.com' }],
      { people: [makePerson({ email: 'erin@acme.com' })] },
    );

    expect(passed[0]?.resourceId).toBe('erin@acme.com');
  });

  it('prefers the SAML identity over a differing verified domain email', async () => {
    const { passed } = await run(
      [{ login: 'frank', samlEmail: 'frank@acme.com', verifiedDomainEmail: 'f.old@acme.com' }],
      { people: [makePerson({ email: 'frank@acme.com' })] },
    );

    expect(passed[0]?.resourceId).toBe('frank@acme.com');
  });

  it('matches an account against an email linked to the person for GitHub', async () => {
    const { passed, failed } = await run([{ login: 'dave', profileEmail: 'dave@gmail.com' }], {
      people: [
        makePersonWithLinkedGithub({
          email: 'dave@acme.com',
          linked: 'dave@gmail.com',
          name: 'Dave D',
        }),
      ],
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.description).toContain('Dave D');
  });

  it('ignores an email linked for a different provider', async () => {
    const { passed, failed } = await run([{ login: 'eve', profileEmail: 'eve@gmail.com' }], {
      people: [
        makePerson({
          email: 'eve@acme.com',
          linkedEmails: [{ source: 'slack', email: 'eve@gmail.com' }],
        }),
      ],
    });

    expect(passed).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('GitHub account not in People directory: @eve');
  });

  it('fails an account whose email matches nobody in the directory', async () => {
    const { passed, failed } = await run([{ login: 'mallory', samlEmail: 'mallory@evil.com' }], {
      people: [makePerson({ email: 'alice@acme.com' })],
    });

    expect(passed).toEqual([]);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('GitHub account not in People directory: @mallory');
    expect(failed[0]?.severity).toBe('medium');
  });

  it('raises severity to high when an unmatched account is an organization owner', async () => {
    const { failed } = await run(
      [{ login: 'mallory', samlEmail: 'mallory@evil.com', isAdmin: true }],
      { people: [] },
    );

    expect(failed[0]?.severity).toBe('high');
  });

  it('reports an account with no resolvable email as unattributable', async () => {
    const { failed } = await run([{ login: 'ghost' }], {
      people: [makePerson({ email: 'alice@acme.com' })],
    });

    expect(failed).toHaveLength(1);
    expect(failed[0]?.title).toBe('GitHub account cannot be attributed: @ghost');
    expect(failed[0]?.resourceId).toBe('acme/ghost');
  });

  it('skips GitHub App bot accounts', async () => {
    const { passed, failed } = await run(
      [
        { login: 'dependabot[bot]', type: 'Bot' },
        { login: 'alice', samlEmail: 'alice@acme.com' },
      ],
      { people: [makePerson({ email: 'alice@acme.com' })] },
    );

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.resourceId).toBe('alice@acme.com');
  });

  it('skips logins listed as service accounts', async () => {
    const options = buildOptions([{ login: 'acme-ci' }], { people: [] });
    const { passed, failed } = await runGithubCheck(accountsAssociatedCheck, {
      ...options,
      variables: { ...options.variables, ignored_github_logins: 'acme-ci' },
    });

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.title).toBe('No human GitHub accounts found in acme');
  });

  it('labels outside collaborators distinctly', async () => {
    const { failed } = await run(
      [{ login: 'contractor', samlEmail: 'c@vendor.com', outsideCollaborator: true }],
      { people: [] },
    );

    expect(failed[0]?.description).toContain('outside collaborator');
  });

  it('records inventory without accusing anyone when no directory is available', async () => {
    const { passed, failed } = await run([{ login: 'alice', samlEmail: 'alice@acme.com' }]);

    expect(failed).toEqual([]);
    expect(passed).toHaveLength(1);
    expect(passed[0]?.title).toBe('GitHub Account Inventory');
  });

  it('tolerates an organization without a SAML identity provider', async () => {
    const { passed } = await run([{ login: 'bob', profileEmail: 'bob@acme.com' }], {
      graphql: async () => ({ organization: { samlIdentityProvider: null } }),
      people: [makePerson({ email: 'bob@acme.com' })],
    });

    expect(passed).toHaveLength(1);
  });

  it('fails with a configuration finding when no repositories are selected', async () => {
    const { failed } = await runGithubCheck(accountsAssociatedCheck, {
      variables: { target_repos: [] },
    });

    expect(failed[0]?.title).toBe('No repositories configured');
    expect(failed[0]?.severity).toBe('low');
  });
});
