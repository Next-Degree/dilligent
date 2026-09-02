import { describe, expect, it } from 'bun:test';
import { accessReviewCheck } from '../checks/access-review';
import { parseMaxAdmins } from '../variables';
import { createMockContext, member } from './helpers';

describe('attio max-admins parsing', () => {
  it('reads a number or a numeric string', () => {
    expect(parseMaxAdmins({ max_admins: 3 })).toBe(3);
    expect(parseMaxAdmins({ max_admins: ' 3 ' })).toBe(3);
    expect(parseMaxAdmins({ max_admins: 0 })).toBe(0);
  });

  it('returns null for values the customer cannot have meant', () => {
    // Acting on a fractional or negative threshold would raise findings against a
    // limit nobody set, so the check stays an evidence log instead.
    expect(parseMaxAdmins({ max_admins: -1 })).toBeNull();
    expect(parseMaxAdmins({ max_admins: 2.5 })).toBeNull();
    expect(parseMaxAdmins({ max_admins: 'lots' })).toBeNull();
    expect(parseMaxAdmins(undefined)).toBeNull();
  });
});

describe('attio access review check', () => {
  it('records one access_grant row per member with access', async () => {
    const ctx = createMockContext({
      members: [member('alice'), member('bob', { access_level: 'admin' })],
    });

    await accessReviewCheck.run(ctx);

    const grants = ctx._passes.filter((row) => row.resourceType === 'access_grant');
    expect(grants.map((row) => row.resourceId)).toEqual(['alice@acme.com', 'bob@acme.com']);
    // A distinct resourceType keeps these rows from colliding with the employee roster.
    expect(ctx._passes.some((row) => row.resourceType === 'user')).toBe(false);
  });

  it('always emits the workspace summary an auditor reads first', async () => {
    const ctx = createMockContext({
      members: [
        member('alice'),
        member('bob', { access_level: 'admin' }),
        member('carol', { access_level: 'suspended' }),
      ],
    });

    await accessReviewCheck.run(ctx);

    const [summary] = ctx._passes.filter((row) => row.resourceType === 'organization');
    const evidence = summary.evidence as Record<string, unknown>;
    expect(evidence.totalUsers).toBe(2);
    expect(evidence.adminUsers).toBe(1);
    expect(evidence.suspendedUsers).toBe(1);
    expect(evidence.adminEmails).toEqual(['bob@acme.com']);
  });

  it('stays an evidence log when no admin threshold is configured', async () => {
    const ctx = createMockContext({
      members: [member('a', { access_level: 'admin' }), member('b', { access_level: 'admin' })],
    });

    await accessReviewCheck.run(ctx);

    // Inventing a limit on the customer's behalf would fail workspaces that have no
    // policy problem at all.
    expect(ctx._fails).toHaveLength(0);
  });

  it('flags admin sprawl once the configured threshold is exceeded', async () => {
    const ctx = createMockContext({
      members: [
        member('a', { access_level: 'admin' }),
        member('b', { access_level: 'admin' }),
        member('c'),
      ],
      variables: { max_admins: 1 },
    });

    await accessReviewCheck.run(ctx);

    expect(ctx._fails).toHaveLength(1);
    const [finding] = ctx._fails;
    expect(finding.resourceType).toBe('organization');
    expect(String(finding.title)).toContain('2 Attio admins exceeds the limit of 1');
    expect(String(finding.remediation)).toContain('a@acme.com');
  });

  it('passes when the admin count sits on the threshold', async () => {
    const ctx = createMockContext({
      members: [member('a', { access_level: 'admin' })],
      variables: { max_admins: 1 },
    });

    await accessReviewCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
  });

  it('emits the summary even for an empty workspace, so the run is never empty', async () => {
    const ctx = createMockContext({ members: [] });

    await accessReviewCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceType).toBe('organization');
  });

  it('explains a rejected API key instead of surfacing a raw HTTP error', async () => {
    const ctx = createMockContext({ membersError: new Error('HTTP 401 Unauthorized') });

    await expect(accessReviewCheck.run(ctx)).rejects.toThrow(/Workspace settings > Developers/);
  });
});
