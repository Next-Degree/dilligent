import { describe, expect, it } from 'bun:test';
import { adminAccessCheck } from '../checks/admin-access';
import { emailDomainsCheck } from '../checks/email-domains';
import { employeeAccessCheck } from '../checks/employee-access';
import { pendingInvitesCheck } from '../checks/pending-invites';
import { createMockContext, member, ORG, person, type MockFixtures } from './mock-context';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const base = (overrides: Partial<MockFixtures> = {}): MockFixtures => ({
  organizations: [ORG],
  members: { [ORG.id]: { members: [], invites: [] } },
  people: [],
  ...overrides,
});

const titles = (items: Array<Record<string, unknown>>) => items.map((item) => item.title);

describe('token and scope guards', () => {
  it('refuses an environment secret key with one actionable finding', async () => {
    const ctx = createMockContext(base({ token: 'tr_prod_sk_123' }));
    await employeeAccessCheck.run(ctx);

    expect(ctx._fails).toHaveLength(1);
    expect(ctx._fails[0].title).toBe('Trigger.dev connection needs a Personal Access Token');
    expect(ctx._requests).toHaveLength(0);
  });

  it('reports a denied organization list instead of passing', async () => {
    const ctx = createMockContext(base({ errors: { '/api/v1/orgs': 401 } }));
    await adminAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(0);
    expect(ctx._fails[0].title).toBe('Failed to read Trigger.dev organizations');
    expect(ctx._fails[0].evidence).toMatchObject({ denied: true });
  });

  it('only reviews the selected organizations', async () => {
    const other = { id: 'org_other', title: 'Other', slug: 'other' };
    const ctx = createMockContext(
      base({
        organizations: [ORG, other],
        members: { [ORG.id]: { members: [member('a@acme.com', 'ADMIN')], invites: [] } },
        variables: { target_organizations: [ORG.id] },
      }),
    );
    await adminAccessCheck.run(ctx);

    expect(ctx._requests.map((r) => r.path)).not.toContain('/api/v1/orgs/org_other/members');
    expect(ctx._passes).toHaveLength(1);
  });
});

describe('employee access', () => {
  it('passes active employees and flags leavers and unknown accounts', async () => {
    const ctx = createMockContext(
      base({
        members: {
          [ORG.id]: {
            members: [
              member('ana@acme.com'),
              member('leaver@acme.com', 'ADMIN'),
              member('stranger@gmail.com'),
              member('octo@users.noreply.github.com'),
            ],
            invites: [],
          },
        },
        people: [
          person({ id: 'p1', email: 'ana@acme.com' }),
          person({
            id: 'p2',
            email: 'leaver@acme.com',
            isActive: false,
            offboardDate: '2026-08-01',
          }),
          person({
            id: 'p3',
            email: 'octo@acme.com',
            linkedEmails: [{ source: 'github', email: 'octo@users.noreply.github.com' }],
          }),
        ],
      }),
    );
    await employeeAccessCheck.run(ctx);

    expect(ctx._passes.map((p) => p.resourceId)).toEqual([
      'acme:ana@acme.com',
      'acme:octo@users.noreply.github.com',
    ]);
    const leaver = ctx._fails.find((f) => f.resourceId === 'acme:leaver@acme.com');
    expect(leaver?.severity).toBe('critical');
    const stranger = ctx._fails.find((f) => f.resourceId === 'acme:stranger@gmail.com');
    expect(stranger?.severity).toBe('medium');
  });

  it('fails once when there is no People directory rather than passing', async () => {
    const ctx = createMockContext(base({ people: undefined }));
    await employeeAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(0);
    expect(titles(ctx._fails)).toEqual([
      'Cannot verify Trigger.dev access without the People directory',
    ]);
  });

  it('reports a members read failure per organization', async () => {
    const ctx = createMockContext(base({ errors: { '/members': 403 } }));
    await employeeAccessCheck.run(ctx);

    expect(ctx._fails[0].title).toBe('Failed to read members of Acme');
    expect(String(ctx._fails[0].remediation)).toContain('Admin role');
  });
});

describe('admin least privilege', () => {
  const admins = (count: number) =>
    Array.from({ length: count }, (_, i) => member(`admin${i}@acme.com`, 'ADMIN'));

  it('passes at the default limit of 3 and records the admin list', async () => {
    const ctx = createMockContext(
      base({
        members: { [ORG.id]: { members: [...admins(3), member('m@acme.com')], invites: [] } },
      }),
    );
    await adminAccessCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes[0].evidence).toMatchObject({ adminCount: 3, maxAdmins: 3, memberCount: 4 });
  });

  it('fails above a configured limit, accepting the value as a string', async () => {
    const ctx = createMockContext(
      base({
        members: { [ORG.id]: { members: admins(3), invites: [] } },
        variables: { max_admins: '2' },
      }),
    );
    await adminAccessCheck.run(ctx);

    expect(ctx._fails[0].title).toBe('Too many Admins: Acme');
  });
});

describe('pending invitations', () => {
  const invite = (email: string, ageDays: number) => ({
    id: `inv_${email}`,
    email,
    updatedAt: daysAgo(ageDays),
  });

  it('flags stale invites and invites to non-employees', async () => {
    const ctx = createMockContext(
      base({
        members: {
          [ORG.id]: {
            members: [],
            invites: [
              invite('new@acme.com', 2),
              invite('old@acme.com', 45),
              invite('who@acme.com', 1),
            ],
          },
        },
        people: [
          person({ id: 'p1', email: 'new@acme.com' }),
          person({ id: 'p2', email: 'old@acme.com' }),
        ],
      }),
    );
    await pendingInvitesCheck.run(ctx);

    expect(ctx._passes.map((p) => p.resourceId)).toEqual(['acme:invite:new@acme.com']);
    expect(String(ctx._fails[0].description)).toContain('45 days');
    expect(String(ctx._fails[1].description)).toContain('not in the People directory');
  });

  it('passes an organization with no open invitations', async () => {
    const ctx = createMockContext(base());
    await pendingInvitesCheck.run(ctx);

    expect(titles(ctx._passes)).toEqual(['No pending invitations: Acme']);
  });
});

describe('corporate email domains', () => {
  it('uses configured domains and flags members and invites outside them', async () => {
    const ctx = createMockContext(
      base({
        members: {
          [ORG.id]: {
            members: [member('ana@acme.com'), member('ana.personal@gmail.com')],
            invites: [{ id: 'inv1', email: 'x@hotmail.com', updatedAt: daysAgo(1) }],
          },
        },
        variables: { corporate_email_domains: '@Acme.com, https://acme.io' },
      }),
    );
    await emailDomainsCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._fails.map((f) => f.resourceId)).toEqual([
      'acme:ana.personal@gmail.com',
      'acme:invite:x@hotmail.com',
    ]);
    expect(ctx._fails[0].evidence).toMatchObject({
      allowedDomains: ['acme.com', 'acme.io'],
      domainSource: 'configured',
    });
  });

  it('falls back to the domains of active people in the directory', async () => {
    const ctx = createMockContext(
      base({
        members: { [ORG.id]: { members: [member('ana@acme.com')], invites: [] } },
        people: [
          person({ id: 'p1', email: 'ana@acme.com' }),
          person({ id: 'p2', email: 'gone@oldco.com', isActive: false }),
        ],
      }),
    );
    await emailDomainsCheck.run(ctx);

    expect(ctx._passes[0].evidence).toMatchObject({
      allowedDomains: ['acme.com'],
      domainSource: 'people-directory',
    });
  });

  it('reports the missing configuration once instead of flagging everyone', async () => {
    const ctx = createMockContext(
      base({ members: { [ORG.id]: { members: [member('a@acme.com')], invites: [] } } }),
    );
    await emailDomainsCheck.run(ctx);

    expect(titles(ctx._fails)).toEqual(['No corporate email domains to check against']);
    expect(ctx._passes).toHaveLength(0);
  });
});
