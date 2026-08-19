import { BadRequestException } from '@nestjs/common';
import {
  EXTERNAL_USER_SOURCES,
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
