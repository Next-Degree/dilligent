import { describe, expect, it } from 'bun:test';
import { registry } from '../../../registry';
import { validAccountsCheck } from '../checks/valid-accounts';
import { posthogManifest } from '../index';
import { createMockContext, invite, member, organization, type Emitted } from './mock-context';

const ACME = organization({ id: 'org-acme' });

function fixtures(options: {
  members?: ReturnType<typeof member>[];
  invites?: ReturnType<typeof invite>[];
  variables?: Record<string, unknown>;
}) {
  return {
    organizations: [ACME],
    organizationDetail: { 'org-acme': ACME },
    members: { 'org-acme': options.members ?? [] },
    invites: { 'org-acme': options.invites ?? [] },
    variables: options.variables,
  };
}

const byResource = (emitted: Emitted[], resourceId: string) =>
  emitted.find((e) => e.resourceId === resourceId);

describe('posthog manifest', () => {
  it('is registered in the registry as a code manifest', () => {
    expect(registry.getManifest('posthog')).toBeDefined();
    expect(registry.isCodeManifest('posthog')).toBe(true);
  });

  it('authenticates with a bearer personal API key', () => {
    expect(posthogManifest.auth.type).toBe('api_key');
    if (posthogManifest.auth.type !== 'api_key') throw new Error('expected api_key auth');
    expect(posthogManifest.auth.config.in).toBe('header');
    expect(posthogManifest.auth.config.name).toBe('Authorization');
    expect(posthogManifest.auth.config.prefix).toBe('Bearer ');
  });

  it('exposes both checks', () => {
    expect(posthogManifest.checks?.map((check) => check.id).sort()).toEqual([
      'posthog_two_factor_auth',
      'posthog_valid_accounts',
    ]);
  });
});

describe('posthog valid accounts check', () => {
  it('passes a verified member on an approved domain, keyed by lowercased email', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'ada', user: { email: 'Ada@Acme.com' } })],
        variables: { allowed_email_domains: 'acme.com' },
      }),
    );

    await validAccountsCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    const pass = byResource(ctx._passes, 'ada@acme.com');
    expect(pass).toBeDefined();
    expect(pass?.resourceType).toBe('user');
    expect((pass?.evidence as Record<string, unknown>).domain).toBe('acme.com');
  });

  it('fails a member whose email domain is not approved', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'contractor', user: { email: 'someone@gmail.com' } })],
        variables: { allowed_email_domains: 'acme.com, acme.io' },
      }),
    );

    await validAccountsCheck.run(ctx);

    const fail = byResource(ctx._fails, 'someone@gmail.com');
    expect(fail).toBeDefined();
    expect(fail?.severity).toBe('high');
    expect(String(fail?.description)).toContain('gmail.com');
  });

  it('skips the domain rule when no approved domains are configured', async () => {
    const ctx = createMockContext(
      fixtures({ members: [member({ id: 'x', user: { email: 'someone@gmail.com' } })] }),
    );

    await validAccountsCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(byResource(ctx._passes, 'someone@gmail.com')).toBeDefined();
  });

  it('fails a member whose email PostHog has not verified', async () => {
    const ctx = createMockContext(
      fixtures({ members: [member({ id: 'ada', user: { is_email_verified: false } })] }),
    );

    await validAccountsCheck.run(ctx);

    const fail = byResource(ctx._fails, 'ada@acme.com');
    expect(fail).toBeDefined();
    expect(fail?.severity).toBe('medium');
    expect(String(fail?.description)).toContain('not verified');
  });

  it('escalates an unverified admin to high severity', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'root', level: 15, user: { is_email_verified: null } })],
      }),
    );

    await validAccountsCheck.run(ctx);

    expect(byResource(ctx._fails, 'root@acme.com')?.severity).toBe('high');
  });

  it('treats SSO sign-in as proof the address is verified', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'sso', has_social_auth: true, user: { is_email_verified: null } })],
      }),
    );

    await validAccountsCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(byResource(ctx._passes, 'sso@acme.com')).toBeDefined();
  });

  it('honours require_verified_email = false', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'ada', user: { is_email_verified: false } })],
        variables: { require_verified_email: 'false' },
      }),
    );

    await validAccountsCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
  });

  it('records an account with no usable email under its membership id', async () => {
    const ctx = createMockContext(
      fixtures({ members: [member({ id: 'broken', user: { email: 'not-an-email' } })] }),
    );

    await validAccountsCheck.run(ctx);

    const fail = byResource(ctx._fails, 'broken');
    expect(fail).toBeDefined();
    expect(fail?.resourceType).toBe('organization_member');
    expect(ctx._passes.some((pass) => pass.resourceType === 'user')).toBe(false);
  });

  it('reports expired invitations and passes pending ones under the invite resource type', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'ada' })],
        invites: [invite({ id: 'stale', is_expired: true }), invite({ id: 'fresh' })],
      }),
    );

    await validAccountsCheck.run(ctx);

    const expired = byResource(ctx._fails, 'stale@acme.com');
    expect(expired?.resourceType).toBe('invite');
    expect(expired?.severity).toBe('low');

    const pending = byResource(ctx._passes, 'fresh@acme.com');
    expect(pending?.resourceType).toBe('invite');
  });

  it('fails an invitation addressed to an unapproved domain', async () => {
    const ctx = createMockContext(
      fixtures({
        invites: [invite({ id: 'outsider', target_email: 'someone@evil.test' })],
        variables: { allowed_email_domains: 'acme.com' },
      }),
    );

    await validAccountsCheck.run(ctx);

    expect(byResource(ctx._fails, 'someone@evil.test')?.severity).toBe('high');
  });

  it('skips invitations when include_pending_invites is off', async () => {
    const ctx = createMockContext(
      fixtures({
        members: [member({ id: 'ada' })],
        invites: [invite({ id: 'stale', is_expired: true })],
        variables: { include_pending_invites: false },
      }),
    );

    await validAccountsCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._requests.some((request) => request.path.includes('/invites/'))).toBe(false);
  });

  it('warns but does not fail the run when invitations cannot be read', async () => {
    const ctx = createMockContext({
      ...fixtures({ members: [member({ id: 'ada' })] }),
      errors: { '/invites/': new Error('HTTP 403: Forbidden') },
    });

    await validAccountsCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._warnings.join(' ')).toContain('invitations');
  });

  it('records an organization-level row when there are no accounts to review', async () => {
    const ctx = createMockContext(fixtures({}));

    await validAccountsCheck.run(ctx);

    const summary = byResource(ctx._passes, 'acme');
    expect(summary?.resourceType).toBe('organization');
  });

  it('paginates past the first page of members', async () => {
    const many = Array.from({ length: 150 }, (_, index) => member({ id: `user-${index}` }));
    const ctx = createMockContext(fixtures({ members: many }));

    await validAccountsCheck.run(ctx);

    expect(ctx._passes.filter((pass) => pass.resourceType === 'user')).toHaveLength(150);
  });

  it('translates a 403 into an actionable scope error', async () => {
    const forbidden = new Error('HTTP 403: Forbidden');
    (forbidden as Error & { status: number }).status = 403;
    const ctx = createMockContext({
      ...fixtures({}),
      errors: { '/members/': forbidden },
    });

    await expect(validAccountsCheck.run(ctx)).rejects.toThrow('organization_member:read');
  });
});
