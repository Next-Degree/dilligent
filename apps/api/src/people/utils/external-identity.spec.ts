import { BadRequestException } from '@nestjs/common';
import {
  EXTERNAL_USER_SOURCES,
  memberIdentityEmails,
  validateExternalIdentityUpdate,
} from './external-identity';

describe('validateExternalIdentityUpdate', () => {
  it('accepts an update that touches neither field', () => {
    expect(() => validateExternalIdentityUpdate({})).not.toThrow();
  });

  it('accepts a complete pair', () => {
    expect(() =>
      validateExternalIdentityUpdate({
        externalUserSource: 'github',
        externalUserId: 'jane@personal.example',
      }),
    ).not.toThrow();
  });

  it('accepts clearing both fields (unlink)', () => {
    expect(() =>
      validateExternalIdentityUpdate({
        externalUserSource: null,
        externalUserId: null,
      }),
    ).not.toThrow();
  });

  it('rejects a source with no email', () => {
    expect(() =>
      validateExternalIdentityUpdate({
        externalUserSource: 'github',
        externalUserId: null,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects an email with no source', () => {
    expect(() =>
      validateExternalIdentityUpdate({
        externalUserSource: null,
        externalUserId: 'jane@personal.example',
      }),
    ).toThrow(BadRequestException);
  });

  // A PATCH carrying one half of the pair is rejected rather than merged with
  // the stored value, so the request body always states the resulting pair.
  it('rejects a partial update that sets only the email', () => {
    expect(() =>
      validateExternalIdentityUpdate({
        externalUserId: 'jane@personal.example',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a partial update that sets only the source', () => {
    expect(() =>
      validateExternalIdentityUpdate({ externalUserSource: 'github' }),
    ).toThrow(BadRequestException);
  });

  it('only offers sources whose access check emits an email as resourceId', () => {
    expect(EXTERNAL_USER_SOURCES).toEqual(['github']);
  });
});

describe('memberIdentityEmails', () => {
  const member = (
    overrides: Partial<{
      email: string | null;
      externalUserId: string | null;
      externalUserSource: string | null;
    }> = {},
  ) => ({
    externalUserId: overrides.externalUserId ?? null,
    externalUserSource: overrides.externalUserSource ?? null,
    user: { email: overrides.email ?? 'ada@acme.com' },
  });

  it('normalizes the sign-in address to the form checks emit', () => {
    expect(memberIdentityEmails(member({ email: '  Ada@ACME.com ' }))).toEqual({
      email: 'ada@acme.com',
      linked: null,
    });
  });

  it('treats a blank sign-in address as no identity at all', () => {
    expect(memberIdentityEmails(member({ email: '   ' })).email).toBeNull();
  });

  it('returns the linked account alongside the sign-in address', () => {
    expect(
      memberIdentityEmails(
        member({
          externalUserId: 'Ada@personal.dev',
          externalUserSource: 'github',
        }),
      ),
    ).toEqual({ email: 'ada@acme.com', linked: 'ada@personal.dev' });
  });

  it('honours the link on any provider when no source is given', () => {
    expect(
      memberIdentityEmails(
        member({
          externalUserId: 'ada@personal.dev',
          externalUserSource: 'slack',
        }),
      ).linked,
    ).toBe('ada@personal.dev');
  });

  it('ignores a link made on another provider when scoped to a source', () => {
    expect(
      memberIdentityEmails(
        member({
          externalUserId: 'ada@personal.dev',
          externalUserSource: 'slack',
        }),
        { source: 'github' },
      ).linked,
    ).toBeNull();
  });

  it('keeps the link when it was made on the source being read', () => {
    expect(
      memberIdentityEmails(
        member({
          externalUserId: 'ada@personal.dev',
          externalUserSource: 'github',
        }),
        { source: 'github' },
      ).linked,
    ).toBe('ada@personal.dev');
  });

  it('does not repeat the sign-in address as a linked alias', () => {
    expect(
      memberIdentityEmails(
        member({
          externalUserId: 'ADA@acme.com',
          externalUserSource: 'github',
        }),
        { source: 'github' },
      ),
    ).toEqual({ email: 'ada@acme.com', linked: null });
  });
});
