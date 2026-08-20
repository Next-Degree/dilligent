import { describe, expect, it } from 'bun:test';
import { TASK_TEMPLATES } from '../../../task-mappings';
import { twoFactorAuthCheck } from '../checks/two-factor-auth';
import { createMockContext, member, organization, type Emitted } from './mock-context';

const ACME = organization({ id: 'org-acme' });

function fixtures(options: {
  members?: ReturnType<typeof member>[];
  variables?: Record<string, unknown>;
  enforce2fa?: boolean | null;
}) {
  return {
    organizations: [ACME],
    organizationDetail: {
      'org-acme': organization({ id: 'org-acme', enforce_2fa: options.enforce2fa ?? true }),
    },
    members: { 'org-acme': options.members ?? [] },
    variables: options.variables,
  };
}

const byResource = (emitted: Emitted[], resourceId: string) =>
  emitted.find((e) => e.resourceId === resourceId);

describe('posthog 2FA check', () => {
  it('is bound to the 2FA task template', () => {
    expect(twoFactorAuthCheck.taskMapping).toBe(TASK_TEMPLATES.twoFactorAuth);
  });

  it('passes a member with 2FA enabled, keyed by lowercased email', async () => {
    const ctx = createMockContext(
      fixtures({ members: [member({ id: 'ada', user: { email: 'Ada@Acme.com' } })] }),
    );

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    const pass = byResource(ctx._passes, 'ada@acme.com');
    expect(pass?.resourceType).toBe('user');
    expect(pass?.title).toBe('2FA Enabled');
  });

  it('fails a member without 2FA', async () => {
    const ctx = createMockContext(
      fixtures({ members: [member({ id: 'ada', is_2fa_enabled: false })] }),
    );

    await twoFactorAuthCheck.run(ctx);

    const fail = byResource(ctx._fails, 'ada@acme.com');
    expect(fail?.severity).toBe('medium');
    expect(String(fail?.remediation)).toContain('two-factor authentication');
  });

  it('escalates a missing-2FA owner to high severity', async () => {
    const ctx = createMockContext(
      fixtures({ members: [member({ id: 'root', level: 15, is_2fa_enabled: false })] }),
    );

    await twoFactorAuthCheck.run(ctx);

    const fail = byResource(ctx._fails, 'root@acme.com');
    expect(fail?.severity).toBe('high');
    expect(String(fail?.description)).toContain('Owner');
  });

  it('treats an SSO member as covered by default', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'sso', is_2fa_enabled: false, has_social_auth: true })],
      }),
    );

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    const pass = byResource(ctx._passes, 'sso@acme.com');
    expect((pass?.evidence as Record<string, unknown>).coveredBySso).toBe(true);
  });

  it('fails an SSO member when treat_sso_as_2fa is off', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'sso', is_2fa_enabled: false, has_social_auth: true })],
        variables: { treat_sso_as_2fa: false },
      }),
    );

    await twoFactorAuthCheck.run(ctx);

    expect(byResource(ctx._fails, 'sso@acme.com')).toBeDefined();
  });

  it('records org-wide enforcement as a passing organization row', async () => {
    const ctx = createMockContext(fixtures({ members: [member({ id: 'ada' })] }));

    await twoFactorAuthCheck.run(ctx);

    const org = byResource(ctx._passes, 'acme');
    expect(org?.resourceType).toBe('organization');
    expect((org?.evidence as Record<string, unknown>).enforce2fa).toBe(true);
  });

  it('warns rather than fails when enforcement is off and not required', async () => {
    const ctx = createMockContext(fixtures({ enforce2fa: false, members: [member({ id: 'a' })] }));

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._warnings.join(' ')).toContain('does not enforce 2FA');
    expect(byResource(ctx._passes, 'acme')?.resourceType).toBe('organization');
  });

  it('fails on missing enforcement when require_2fa_enforcement is on', async () => {
    const ctx = createMockContext(
      fixtures({
        enforce2fa: false,
        members: [member({ id: 'a' })],
        variables: { require_2fa_enforcement: true },
      }),
    );

    await twoFactorAuthCheck.run(ctx);

    const fail = byResource(ctx._fails, 'acme');
    expect(fail?.resourceType).toBe('organization');
    expect(fail?.severity).toBe('medium');
  });

  it('still checks members when organization settings cannot be read', async () => {
    const ctx = createMockContext({
      organizations: [ACME],
      organizationDetail: {},
      members: { 'org-acme': [member({ id: 'ada', is_2fa_enabled: false })] },
    });

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._passes.some((pass) => pass.resourceType === 'organization')).toBe(false);
    expect(byResource(ctx._fails, 'ada@acme.com')).toBeDefined();
  });

  it('skips members with no email rather than emitting an unkeyable row', async () => {
    const ctx = createMockContext(
      fixtures({ members: [member({ id: 'ghost', user: { email: null } })] }),
    );

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._passes.some((pass) => pass.resourceType === 'user')).toBe(false);
    expect(ctx._fails).toHaveLength(0);
    expect(ctx._warnings.join(' ')).toContain('no email on record');
  });

  it('checks only the selected organization', async () => {
    const other = organization({ id: 'org-other', name: 'Other', slug: 'other' });
    const ctx = createMockContext({
      organizations: [ACME, other],
      organizationDetail: { 'org-acme': ACME, 'org-other': other },
      members: {
        'org-acme': [member({ id: 'ada' })],
        'org-other': [member({ id: 'bob', user: { email: 'bob@other.com' } })],
      },
      variables: { target_organizations: ['org-other'] },
    });

    await twoFactorAuthCheck.run(ctx);

    expect(byResource(ctx._passes, 'bob@other.com')).toBeDefined();
    expect(byResource(ctx._passes, 'ada@acme.com')).toBeUndefined();
  });

  it('falls back to @current when the key cannot list organizations', async () => {
    const ctx = createMockContext({
      organizations: [],
      organizationDetail: { '@current': organization({ id: 'org-acme' }) },
      members: { 'org-acme': [member({ id: 'ada' })] },
    });

    await twoFactorAuthCheck.run(ctx);

    expect(byResource(ctx._passes, 'ada@acme.com')).toBeDefined();
    expect(ctx._requests.some((request) => request.path === '/api/organizations/@current/')).toBe(
      true,
    );
  });

  it('translates a 401 into an actionable credential error', async () => {
    const unauthorized = new Error('HTTP 401: Unauthorized');
    (unauthorized as Error & { status: number }).status = 401;
    const ctx = createMockContext({
      organizations: [ACME],
      organizationDetail: { 'org-acme': ACME },
      errors: { '/members/': unauthorized },
    });

    await expect(twoFactorAuthCheck.run(ctx)).rejects.toThrow('rejected the API key');
  });
});
