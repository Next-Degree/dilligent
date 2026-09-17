import { describe, expect, it } from 'bun:test';
import { employeeAccessCheck } from '../checks/employee-access';
import { createMockContext, member } from './helpers';

describe('attio employee access check', () => {
  it('emits one user row per member with access, keyed by lowercased email', async () => {
    const ctx = createMockContext({
      members: [
        member('alice', {
          first_name: 'Alice',
          last_name: 'Adams',
          email_address: 'Alice@Acme.com',
        }),
        member('bob', { first_name: 'Bob', last_name: 'Brown', access_level: 'admin' }),
      ],
    });

    await employeeAccessCheck.run(ctx);

    const users = ctx._passes.filter((row) => row.resourceType === 'user');
    expect(users.map((row) => row.resourceId)).toEqual(['alice@acme.com', 'bob@acme.com']);
    expect(ctx._fails).toHaveLength(0);
  });

  it('records the access level as the role, so an access review can read it', async () => {
    const ctx = createMockContext({
      members: [member('bob', { access_level: 'admin' })],
    });

    await employeeAccessCheck.run(ctx);

    const [row] = ctx._passes.filter((entry) => entry.resourceType === 'user');
    const evidence = row.evidence as Record<string, unknown>;
    expect(evidence.role).toBe('Admin');
    expect(evidence.isAdmin).toBe(true);
    expect(evidence.roles).toEqual(['Admin']);
  });

  it('keeps suspended members out of the user roster but in the audit trail', async () => {
    const ctx = createMockContext({
      members: [member('alice'), member('carol', { access_level: 'suspended' })],
    });

    await employeeAccessCheck.run(ctx);

    // Attio never deletes members, so a suspended row is history, not access. A
    // person-scoped consumer reading resourceType 'user' must never see it.
    const users = ctx._passes.filter((row) => row.resourceType === 'user');
    expect(users.map((row) => row.resourceId)).toEqual(['alice@acme.com']);

    const suspended = ctx._passes.filter((row) => row.resourceType === 'suspended_member');
    expect(suspended).toHaveLength(1);
    expect(suspended[0].resourceId).toBe('carol@acme.com');
  });

  it('labels evidence with the workspace read from /v2/self', async () => {
    const ctx = createMockContext({ members: [member('alice')] });

    await employeeAccessCheck.run(ctx);

    expect(ctx._paths).toContain('/v2/self');
    const [row] = ctx._passes.filter((entry) => entry.resourceType === 'user');
    expect((row.evidence as Record<string, unknown>).workspace).toBe('Acme');
  });

  it('still completes when /v2/self fails, since it only supplies evidence labels', async () => {
    const ctx = createMockContext({
      members: [member('alice')],
      selfError: new Error('HTTP 500'),
    });

    await employeeAccessCheck.run(ctx);

    expect(ctx._warnings.join(' ')).toContain('Could not identify the Attio workspace');
    expect(ctx._passes.filter((row) => row.resourceType === 'user')).toHaveLength(1);
  });

  it('emits an org-level row when nobody holds access, so the run is never empty', async () => {
    const ctx = createMockContext({
      members: [member('carol', { access_level: 'suspended' })],
    });

    await employeeAccessCheck.run(ctx);

    const org = ctx._passes.filter((row) => row.resourceType === 'organization');
    expect(org).toHaveLength(1);
    expect(org[0].resourceId).toBe('acme');
    expect((org[0].evidence as Record<string, unknown>).suspendedUsers).toBe(1);
  });

  it('skips a member with no email rather than emitting an unjoinable row', async () => {
    const ctx = createMockContext({
      members: [member('ghost', { email_address: '' }), member('alice')],
    });

    await employeeAccessCheck.run(ctx);

    const users = ctx._passes.filter((row) => row.resourceType === 'user');
    expect(users.map((row) => row.resourceId)).toEqual(['alice@acme.com']);
    expect(ctx._warnings.join(' ')).toContain('no email address on record');
  });

  it('explains a rejected API key instead of surfacing a raw HTTP error', async () => {
    const ctx = createMockContext({ membersError: new Error('HTTP 401 Unauthorized') });

    await expect(employeeAccessCheck.run(ctx)).rejects.toThrow(/Workspace settings > Developers/);
  });

  it('names the missing scope when Attio answers 403', async () => {
    const ctx = createMockContext({ membersError: new Error('HTTP 403 Forbidden') });

    await expect(employeeAccessCheck.run(ctx)).rejects.toThrow(/user_management:read/);
  });
});
