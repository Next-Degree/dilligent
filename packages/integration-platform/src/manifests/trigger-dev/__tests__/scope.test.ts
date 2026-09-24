import { describe, expect, it } from 'bun:test';
import { adminAccessCheck } from '../checks/admin-access';
import { employeeAccessCheck } from '../checks/employee-access';
import { createMockContext, member, ORG, type MockFixtures } from './mock-context';

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
    expect(ctx._fails[0].title).toBe('Trigger.dev connection needs a valid Personal Access Token');
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

  it('does not widen to other organizations when the selection is no longer visible', async () => {
    const other = { id: 'org_other', title: 'Other', slug: 'other' };
    const ctx = createMockContext(
      base({
        organizations: [other],
        members: { org_other: { members: [member('x@other.com', 'ADMIN')], invites: [] } },
        variables: { target_organizations: [ORG.id] },
      }),
    );
    await adminAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(0);
    expect(titles(ctx._fails)).toEqual(['Selected Trigger.dev organizations are not visible']);
    expect(ctx._requests.map((r) => r.path)).not.toContain('/api/v1/orgs/org_other/members');
  });

  it('reviews the visible selection and reports the selected org it cannot see', async () => {
    const ctx = createMockContext(
      base({
        members: { [ORG.id]: { members: [member('a@acme.com', 'ADMIN')], invites: [] } },
        variables: { target_organizations: 'acme, gone-org' },
      }),
    );
    await adminAccessCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._fails[0].evidence).toMatchObject({ missing: ['gone-org'] });
  });

  it('rejects a Personal Access Token stored with surrounding whitespace', async () => {
    const ctx = createMockContext(base({ token: ' tr_pat_abc' }));
    await employeeAccessCheck.run(ctx);

    expect(ctx._fails[0].evidence).toMatchObject({ problem: 'whitespace' });
    expect(ctx._requests).toHaveLength(0);
  });
});
