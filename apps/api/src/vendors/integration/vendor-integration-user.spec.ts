import {
  toVendorIntegrationUsers,
  type TaggedCheckResultRow,
} from './vendor-integration-user';

const CHECK_NAMES = new Map([
  ['github_employee_access', 'Employee Access'],
  ['github_2fa', 'Two-Factor Authentication'],
]);

const MEMBERS = new Map([
  [
    'ada@acme.com',
    {
      id: 'mem_1',
      name: 'Ada Lovelace',
      email: 'ada@acme.com',
      image: null,
      deactivated: false,
    },
  ],
]);

function row(
  overrides: Partial<TaggedCheckResultRow> = {},
): TaggedCheckResultRow {
  return {
    resultId: 'icx_1',
    checkId: 'github_employee_access',
    resourceId: 'ada@acme.com',
    resourceType: 'user',
    passed: true,
    title: 'Access reviewed',
    description: null,
    evidence: {
      email: 'ada@acme.com',
      name: 'Ada Lovelace',
      role: 'admin',
      isAdmin: true,
    },
    collectedAt: new Date('2026-01-01T00:00:00.000Z'),
    runId: 'icr_1',
    connectionId: 'icn_1',
    ...overrides,
  };
}

const users = (results: TaggedCheckResultRow[]) =>
  toVendorIntegrationUsers({
    results,
    checkNamesById: CHECK_NAMES,
    membersByEmail: MEMBERS,
  });

describe('toVendorIntegrationUsers', () => {
  it('maps a user row and joins it to the matching org member', () => {
    expect(users([row()])).toEqual([
      expect.objectContaining({
        email: 'ada@acme.com',
        name: 'Ada Lovelace',
        role: 'admin',
        isAdmin: true,
        passed: true,
        checks: [
          { checkId: 'github_employee_access', checkName: 'Employee Access' },
        ],
        member: MEMBERS.get('ada@acme.com'),
      }),
    ]);
  });

  it('merges the same person across checks, failing wins', () => {
    const merged = users([
      row(),
      row({
        resultId: 'icx_2',
        checkId: 'github_2fa',
        passed: false,
        evidence: { email: 'ADA@acme.com' },
        collectedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].passed).toBe(false);
    expect(merged[0].checks.map((c) => c.checkName)).toEqual([
      'Employee Access',
      'Two-Factor Authentication',
    ]);
    expect(merged[0].collectedAt).toEqual(new Date('2026-01-02T00:00:00.000Z'));
    // Evidence from the first row survives a later row that omits it.
    expect(merged[0].name).toBe('Ada Lovelace');
  });

  it('keeps a person with no email and reports no member for them', () => {
    const [user] = users([
      row({ resourceId: 'U123', evidence: { name: 'Legacy Account' } }),
    ]);
    expect(user.email).toBeNull();
    expect(user.resourceId).toBe('U123');
    expect(user.member).toBeNull();
  });

  it('survives evidence whose fields have the wrong type', () => {
    const [user] = users([row({ evidence: { name: 42, role: 'viewer' } })]);
    expect(user.name).toBeNull();
    expect(user.role).toBe('viewer');
  });

  it('survives evidence that is not an object at all', () => {
    const [user] = users([row({ evidence: 'nope' })]);
    expect(user.email).toBe('ada@acme.com');
    expect(user.role).toBeNull();
  });

  it('lists flagged people first, then alphabetically', () => {
    const ordered = users([
      row({ resourceId: 'zoe@acme.com', evidence: {} }),
      row({ resourceId: 'bob@acme.com', evidence: {} }),
      row({ resourceId: 'sam@acme.com', passed: false, evidence: {} }),
    ]).map((u) => u.email);
    expect(ordered).toEqual(['sam@acme.com', 'bob@acme.com', 'zoe@acme.com']);
  });
});
