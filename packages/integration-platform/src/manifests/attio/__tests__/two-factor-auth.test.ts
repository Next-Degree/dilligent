import { describe, expect, it } from 'bun:test';
import { twoFactorAuthCheck } from '../checks/two-factor-auth';
import { classifyEmailDomain, parseApprovedDomains } from '../variables';
import { createMockContext, member } from './helpers';

describe('attio approved-domain parsing', () => {
  it('accepts the separators and shapes people actually type', () => {
    expect(
      parseApprovedDomains({ approved_identity_domains: '@Acme.com, acme.io; alice@acme.dev' }),
    ).toEqual(['acme.com', 'acme.io', 'acme.dev']);
  });

  it('drops bare words, which are typos rather than domains', () => {
    // Letting "acme" through would leave the check looking configured while
    // approving nothing.
    expect(parseApprovedDomains({ approved_identity_domains: 'acme, acme.com' })).toEqual([
      'acme.com',
    ]);
  });

  it('normalises a leading dot so .acme.com still covers acme.com', () => {
    expect(parseApprovedDomains({ approved_identity_domains: '.acme.com' })).toEqual(['acme.com']);
    expect(
      classifyEmailDomain(
        'alice@acme.com',
        parseApprovedDomains({
          approved_identity_domains: '.acme.com',
        }),
      ).verdict,
    ).toBe('approved');
  });

  it('still rejects a bare TLD, which would approve every account under it', () => {
    // Stripping the dot leaves "com", which the two-label check then drops. Doing the
    // two checks in the other order would let this through.
    expect(parseApprovedDomains({ approved_identity_domains: '.com' })).toEqual([]);
    expect(parseApprovedDomains({ approved_identity_domains: 'com' })).toEqual([]);
  });

  it('returns nothing when unset', () => {
    expect(parseApprovedDomains(undefined)).toEqual([]);
    expect(parseApprovedDomains({})).toEqual([]);
  });
});

describe('attio domain classification', () => {
  it('covers subdomains of an approved domain', () => {
    expect(classifyEmailDomain('alice@mail.acme.com', ['acme.com']).verdict).toBe('approved');
  });

  it('does not treat a lookalike suffix as approved', () => {
    // notacme.com ends with "acme.com" as a string but is a different organisation.
    expect(classifyEmailDomain('mallory@notacme.com', ['acme.com']).verdict).toBe('unapproved');
  });

  it('flags consumer mailboxes even when no allow-list is configured', () => {
    const result = classifyEmailDomain('alice@gmail.com', []);
    expect(result.verdict).toBe('consumer');
    expect(result.mode).toBe('consumer-only');
  });

  it('assumes a non-consumer domain is corporate when no allow-list is configured', () => {
    const result = classifyEmailDomain('alice@acme.com', []);
    expect(result.verdict).toBe('approved');
    // The mode is recorded so an auditor can tell an assumed pass from a verified one.
    expect(result.mode).toBe('consumer-only');
  });

  it('treats an unreadable address as unattributable', () => {
    expect(classifyEmailDomain('', ['acme.com']).verdict).toBe('unapproved');
    expect(classifyEmailDomain('', ['acme.com']).domain).toBeNull();
  });
});

describe('attio two-factor coverage check', () => {
  it('passes members on an approved identity-provider domain', async () => {
    const ctx = createMockContext({
      members: [member('alice')],
      variables: { approved_identity_domains: 'acme.com' },
    });

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    const [row] = ctx._passes;
    expect(row.resourceType).toBe('user');
    expect(row.resourceId).toBe('alice@acme.com');
  });

  it('fails a member on a personal mailbox, where no IdP can enforce 2FA', async () => {
    const ctx = createMockContext({
      members: [member('alice', { email_address: 'alice@gmail.com' })],
    });

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._passes).toHaveLength(0);
    const [finding] = ctx._fails;
    expect(finding.severity).toBe('medium');
    expect(String(finding.description)).toContain('personal email account');
  });

  it('raises the severity for an admin outside the identity perimeter', async () => {
    const ctx = createMockContext({
      members: [member('bob', { email_address: 'bob@gmail.com', access_level: 'admin' })],
    });

    await twoFactorAuthCheck.run(ctx);

    // An admin outside the perimeter can change the whole workspace.
    expect(ctx._fails[0].severity).toBe('high');
    expect(String(ctx._fails[0].title)).toContain('Admin');
  });

  it('fails a domain that is absent from a configured allow-list', async () => {
    const ctx = createMockContext({
      members: [member('dana', { email_address: 'dana@contractor.io' })],
      variables: { approved_identity_domains: 'acme.com' },
    });

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._fails).toHaveLength(1);
    expect(String(ctx._fails[0].description)).toContain('not one of your identity');
  });

  it('never claims to have read MFA state, because Attio does not expose it', async () => {
    const ctx = createMockContext({
      members: [member('alice'), member('bob', { email_address: 'bob@gmail.com' })],
    });

    await twoFactorAuthCheck.run(ctx);

    for (const row of [...ctx._passes, ...ctx._fails]) {
      expect((row.evidence as Record<string, unknown>).mfaVerifiable).toBe(false);
    }
  });

  it('records the allow-list and match mode as evidence', async () => {
    const ctx = createMockContext({
      members: [member('alice')],
      variables: { approved_identity_domains: 'acme.com' },
    });

    await twoFactorAuthCheck.run(ctx);

    const evidence = ctx._passes[0].evidence as Record<string, unknown>;
    expect(evidence.approvedDomains).toEqual(['acme.com']);
    expect(evidence.matchMode).toBe('allow-list');
    expect(evidence.emailDomain).toBe('acme.com');
  });

  it('ignores suspended members, who hold no access to secure', async () => {
    const ctx = createMockContext({
      members: [member('carol', { email_address: 'carol@gmail.com', access_level: 'suspended' })],
    });

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._fails).toHaveLength(0);
    expect(ctx._passes.filter((row) => row.resourceType === 'user')).toHaveLength(0);
  });

  it('emits an org-level row when nobody holds access, so the run is never empty', async () => {
    const ctx = createMockContext({ members: [] });

    await twoFactorAuthCheck.run(ctx);

    expect(ctx._passes).toHaveLength(1);
    expect(ctx._passes[0].resourceType).toBe('organization');
    expect(ctx._fails).toHaveLength(0);
  });

  it('falls back to the Attio member id when a member has no email', async () => {
    const ctx = createMockContext({ members: [member('ghost', { email_address: '' })] });

    await twoFactorAuthCheck.run(ctx);

    // A stable, non-colliding row beats silently dropping an account that holds access.
    expect(ctx._fails[0].resourceId).toBe('ghost');
    expect(String(ctx._fails[0].description)).toContain('no email address on record');
  });

  it('explains a rejected API key instead of surfacing a raw HTTP error', async () => {
    const ctx = createMockContext({ membersError: new Error('HTTP 401 Unauthorized') });

    await expect(twoFactorAuthCheck.run(ctx)).rejects.toThrow(/Workspace settings > Developers/);
  });
});
