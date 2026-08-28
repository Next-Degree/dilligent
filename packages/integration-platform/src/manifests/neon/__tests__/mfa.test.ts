import { describe, expect, it } from 'bun:test';
import { mfaCheck } from '../checks';
import type { NeonFixture } from './harness';
import { findByResourceId, httpError, makeMember, makeNeonContext, makeProject } from './harness';

const run = async (fixture: NeonFixture) => {
  const recorded = makeNeonContext(fixture);
  await mfaCheck.run(recorded.ctx);
  return recorded;
};

describe('mfaCheck', () => {
  it('passes members with MFA and fails those without', async () => {
    const recorded = await run({
      organizations: [{ id: 'org-1', name: 'Acme', plan: 'scale' }],
      projects: [],
      members: {
        'org-1': [
          makeMember('ada@acme.com', { hasMfa: true }),
          makeMember('bob@acme.com', { hasMfa: false }),
        ],
      },
    });

    expect(findByResourceId(recorded.passes, 'mem-ada@acme.com')?.title).toBe(
      'MFA enabled: ada@acme.com',
    );
    const failure = findByResourceId(recorded.fails, 'mem-bob@acme.com');
    expect(failure?.title).toBe('MFA not enabled: bob@acme.com');
    expect(failure?.severity).toBe('high');
  });

  it('reports unknown, not compliant, when Neon omits has_mfa', async () => {
    const recorded = await run({
      organizations: [{ id: 'org-1' }],
      projects: [],
      members: { 'org-1': [makeMember('legacy@acme.com')] },
    });

    const failure = findByResourceId(recorded.fails, 'mem-legacy@acme.com');
    expect(failure?.title).toBe('MFA status unknown: legacy@acme.com');
    expect(failure?.severity).toBe('medium');
    expect(failure?.evidence).toMatchObject({ hasMfa: null });
  });

  it('does not judge deactivated members, but counts them', async () => {
    const recorded = await run({
      organizations: [{ id: 'org-1' }],
      projects: [],
      members: {
        'org-1': [
          makeMember('ada@acme.com', { hasMfa: true }),
          makeMember('gone@acme.com', { hasMfa: false, deactivatedAt: '2026-02-01T00:00:00Z' }),
        ],
      },
    });

    expect(recorded.fails).toHaveLength(0);
    expect(findByResourceId(recorded.passes, 'org-1')?.evidence).toMatchObject({
      memberCount: 2,
      activeMemberCount: 1,
      deactivatedMemberCount: 1,
    });
  });

  it('discovers the organization from project org_id when the key is organization-scoped', async () => {
    const recorded = await run({
      projects: [makeProject({ id: 'prj-a', org_id: 'org-from-project' })],
      members: { 'org-from-project': [makeMember('ada@acme.com', { hasMfa: true })] },
    });

    expect(recorded.requests).toContain('organizations/org-from-project/members?limit=100');
    expect(findByResourceId(recorded.passes, 'mem-ada@acme.com')).toBeDefined();
  });

  it('fails when no organization can be resolved at all', async () => {
    const recorded = await run({ projects: [makeProject({ id: 'prj-a', org_id: undefined })] });

    expect(findByResourceId(recorded.fails, 'organizations')?.title).toBe(
      'No Neon organization found',
    );
  });

  it('fails loudly when the member list is denied', async () => {
    const recorded = await run({
      organizations: [{ id: 'org-1', name: 'Acme' }],
      projects: [],
      members: { 'org-1': httpError(403) },
    });

    const failure = findByResourceId(recorded.fails, 'org-1');
    expect(failure?.title).toBe('MFA status unknown for organization Acme');
    expect(failure?.remediation).toContain('admin access');
  });
});
